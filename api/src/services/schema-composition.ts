import {
  parse,
  print,
  visit,
  DocumentNode,
  ObjectTypeDefinitionNode,
  FieldDefinitionNode,
  DirectiveNode,
  NamedTypeNode,
  TypeNode,
  InputObjectTypeDefinitionNode,
  EnumTypeDefinitionNode,
  ScalarTypeDefinitionNode,
  InterfaceTypeDefinitionNode,
  UnionTypeDefinitionNode,
  DefinitionNode,
  ArgumentNode,
  StringValueNode,
  NameNode,
  GraphQLString,
} from 'graphql';
import {
  CompositionResult,
  CompositionError,
  CompositionWarning,
  ChangeItem,
  ChangeSummary,
} from '../types';

export interface SubgraphSchema {
  name: string;
  sdl: string;
  document?: DocumentNode;
}

export interface ParsedSubgraph {
  name: string;
  sdl: string;
  document: DocumentNode;
  types: Map<string, ObjectTypeDefinitionNode>;
  interfaces: Map<string, InterfaceTypeDefinitionNode>;
  unions: Map<string, UnionTypeDefinitionNode>;
  scalars: Map<string, ScalarTypeDefinitionNode>;
  enums: Map<string, EnumTypeDefinitionNode>;
  inputs: Map<string, InputObjectTypeDefinitionNode>;
  entities: Set<string>;
}

const FEDERATION_DIRECTIVES = ['@key', '@requires', '@provides', '@external', '@shareable', '@inaccessible', '@override', '@tag'];

function parseSchema(sdl: string): DocumentNode {
  return parse(sdl, { noLocation: false });
}

function getTypeName(type: TypeNode): string {
  if (type.kind === 'NamedType') {
    return type.name.value;
  }
  return getTypeName(type.type);
}

function isListType(type: TypeNode): boolean {
  if (type.kind === 'ListType') return true;
  if (type.kind === 'NonNullType') return isListType(type.type);
  return false;
}

function isNonNullType(type: TypeNode): boolean {
  return type.kind === 'NonNullType';
}

function getDirectiveByName(node: { directives?: readonly DirectiveNode[] }, name: string): DirectiveNode | undefined {
  return node.directives?.find(d => d.name.value === name);
}

function getDirectiveArgValue(directive: DirectiveNode, argName: string): string | undefined {
  const arg = directive.arguments?.find(a => a.name.value === argName);
  if (arg && arg.value.kind === 'StringValue') {
    return (arg.value as StringValueNode).value;
  }
  return undefined;
}

function hasFederationDirective(node: { directives?: readonly DirectiveNode[] }): boolean {
  return FEDERATION_DIRECTIVES.some(d => 
    node.directives?.some(dir => `@${dir.name.value}` === d || dir.name.value === d.replace('@', ''))
  );
}

export function parseSubgraph(subgraph: SubgraphSchema): ParsedSubgraph {
  const document = parseSchema(subgraph.sdl);
  const types = new Map<string, ObjectTypeDefinitionNode>();
  const interfaces = new Map<string, InterfaceTypeDefinitionNode>();
  const unions = new Map<string, UnionTypeDefinitionNode>();
  const scalars = new Map<string, ScalarTypeDefinitionNode>();
  const enums = new Map<string, EnumTypeDefinitionNode>();
  const inputs = new Map<string, InputObjectTypeDefinitionNode>();
  const entities = new Set<string>();

  for (const def of document.definitions) {
    if (def.kind === 'ObjectTypeDefinition' && def.name) {
      const typeName = def.name.value;
      types.set(typeName, def);
      if (getDirectiveByName(def, 'key')) {
        entities.add(typeName);
      }
    } else if (def.kind === 'InterfaceTypeDefinition' && def.name) {
      interfaces.set(def.name.value, def);
    } else if (def.kind === 'UnionTypeDefinition' && def.name) {
      unions.set(def.name.value, def);
    } else if (def.kind === 'ScalarTypeDefinition' && def.name) {
      scalars.set(def.name.value, def);
    } else if (def.kind === 'EnumTypeDefinition' && def.name) {
      enums.set(def.name.value, def);
    } else if (def.kind === 'InputObjectTypeDefinition' && def.name) {
      inputs.set(def.name.value, def);
    }
  }

  return {
    name: subgraph.name,
    sdl: subgraph.sdl,
    document,
    types,
    interfaces,
    unions,
    scalars,
    enums,
    inputs,
    entities,
  };
}

function validateScalarsConsistency(subgraphs: ParsedSubgraph[]): CompositionError[] {
  const errors: CompositionError[] = [];
  const scalarDefinitions = new Map<string, { subgraph: string; line?: number }[]>();

  for (const sg of subgraphs) {
    for (const [name, node] of sg.scalars) {
      if (!scalarDefinitions.has(name)) {
        scalarDefinitions.set(name, []);
      }
      scalarDefinitions.get(name)!.push({
        subgraph: sg.name,
        line: node.loc?.start,
      });
    }
  }

  for (const [name, defs] of scalarDefinitions) {
    if (defs.length > 1 && !['String', 'Int', 'Float', 'Boolean', 'ID'].includes(name)) {
      errors.push({
        subgraph: defs[0].subgraph,
        message: `Scalar "${name}" is defined in multiple subgraphs: ${defs.map(d => d.subgraph).join(', ')}. Custom scalars must be defined consistently.`,
        line: defs[0].line,
      });
    }
  }

  return errors;
}

function validateEnumsConsistency(subgraphs: ParsedSubgraph[]): CompositionError[] {
  const errors: CompositionError[] = [];
  const enumValues = new Map<string, Map<string, { subgraph: string; line?: number }>>();

  for (const sg of subgraphs) {
    for (const [name, enumNode] of sg.enums) {
      if (!enumValues.has(name)) {
        enumValues.set(name, new Map());
      }
      const valueMap = enumValues.get(name)!;
      for (const value of enumNode.values || []) {
        const valueName = value.name.value;
        if (!valueMap.has(valueName)) {
          valueMap.set(valueName, { subgraph: sg.name, line: value.loc?.start });
        }
      }
    }
  }

  return errors;
}

function validateFieldTypeConsistency(subgraphs: ParsedSubgraph[]): CompositionError[] {
  const errors: CompositionError[] = [];
  const fieldTypes = new Map<string, Map<string, { type: string; subgraph: string; line?: number; isExternal: boolean }>>();

  for (const sg of subgraphs) {
    for (const [typeName, typeNode] of sg.types) {
      if (!fieldTypes.has(typeName)) {
        fieldTypes.set(typeName, new Map());
      }
      const typeFieldMap = fieldTypes.get(typeName)!;

      for (const field of typeNode.fields || []) {
        const fieldName = field.name.value;
        const fieldType = getTypeName(field.type);
        const isExternal = !!getDirectiveByName(field, 'external');

        if (!typeFieldMap.has(fieldName)) {
          typeFieldMap.set(fieldName, {
            type: fieldType,
            subgraph: sg.name,
            line: field.loc?.start,
            isExternal,
          });
        } else if (!isExternal) {
          const existing = typeFieldMap.get(fieldName)!;
          if (!existing.isExternal && existing.type !== fieldType) {
            errors.push({
              subgraph: sg.name,
              message: `Field "${typeName}.${fieldName}" has conflicting types: "${existing.type}" in ${existing.subgraph} vs "${fieldType}" in ${sg.name}`,
              line: field.loc?.start,
            });
          }
        }
      }
    }
  }

  return errors;
}

function validateEntityKeys(subgraphs: ParsedSubgraph[]): CompositionError[] {
  const errors: CompositionError[] = [];
  const entityKeys = new Map<string, Set<string>>();

  for (const sg of subgraphs) {
    for (const entityName of sg.entities) {
      const typeNode = sg.types.get(entityName);
      if (!typeNode) continue;

      const keyDirectives = typeNode.directives?.filter(d => d.name.value === 'key') || [];
      const keyFields = new Set<string>();

      for (const keyDir of keyDirectives) {
        const fieldsArg = getDirectiveArgValue(keyDir, 'fields');
        if (fieldsArg) {
          fieldsArg.split(/\s+/).filter(Boolean).forEach(f => keyFields.add(f));
        }
      }

      if (!entityKeys.has(entityName)) {
        entityKeys.set(entityName, keyFields);
      } else {
        const existingKeys = entityKeys.get(entityName)!;
        if (keyFields.size > 0) {
          const hasCommonKey = [...keyFields].some(k => existingKeys.has(k));
          if (!hasCommonKey) {
            errors.push({
              subgraph: sg.name,
              message: `Entity "${entityName}" in subgraph "${sg.name}" has no common @key fields with other subgraphs. Expected at least one of: ${[...existingKeys].join(', ')}`,
            });
          }
        }
      }
    }
  }

  return errors;
}

function mergeSubgraphs(subgraphs: ParsedSubgraph[]): DocumentNode {
  const mergedTypes = new Map<string, ObjectTypeDefinitionNode>();
  const mergedInterfaces = new Map<string, InterfaceTypeDefinitionNode>();
  const mergedUnions = new Map<string, UnionTypeDefinitionNode>();
  const mergedScalars = new Map<string, ScalarTypeDefinitionNode>();
  const mergedEnums = new Map<string, EnumTypeDefinitionNode>();
  const mergedInputs = new Map<string, InputObjectTypeDefinitionNode>();

  for (const sg of subgraphs) {
    for (const [name, scalar] of sg.scalars) {
      if (!mergedScalars.has(name)) {
        mergedScalars.set(name, scalar);
      }
    }

    for (const [name, enumNode] of sg.enums) {
      if (!mergedEnums.has(name)) {
        mergedEnums.set(name, enumNode);
      } else {
        const existing = mergedEnums.get(name)!;
        const existingValues = new Set(existing.values?.map(v => v.name.value) || []);
        const newValues = enumNode.values?.filter(v => !existingValues.has(v.name.value)) || [];
        if (newValues.length > 0) {
          mergedEnums.set(name, {
            ...existing,
            values: [...(existing.values || []), ...newValues],
          });
        }
      }
    }

    for (const [name, iface] of sg.interfaces) {
      if (!mergedInterfaces.has(name)) {
        mergedInterfaces.set(name, iface);
      } else {
        const existing = mergedInterfaces.get(name)!;
        const existingFields = new Map(existing.fields?.map(f => [f.name.value, f]) || []);
        const newFields = iface.fields?.filter(f => !existingFields.has(f.name.value)) || [];
        if (newFields.length > 0) {
          mergedInterfaces.set(name, {
            ...existing,
            fields: [...(existing.fields || []), ...newFields],
          });
        }
      }
    }

    for (const [name, unionNode] of sg.unions) {
      if (!mergedUnions.has(name)) {
        mergedUnions.set(name, unionNode);
      } else {
        const existing = mergedUnions.get(name)!;
        const existingTypes = new Set(existing.types?.map(t => t.name.value) || []);
        const newTypes = unionNode.types?.filter(t => !existingTypes.has(t.name.value)) || [];
        if (newTypes.length > 0) {
          mergedUnions.set(name, {
            ...existing,
            types: [...(existing.types || []), ...newTypes],
          });
        }
      }
    }

    for (const [name, input] of sg.inputs) {
      if (!mergedInputs.has(name)) {
        mergedInputs.set(name, input);
      }
    }

    for (const [name, typeNode] of sg.types) {
      if (!mergedTypes.has(name)) {
        mergedTypes.set(name, { ...typeNode, fields: [...(typeNode.fields || [])] });
      } else {
        const existing = mergedTypes.get(name)!;
        const existingFields = new Map(existing.fields?.map(f => [f.name.value, f]) || []);
        const newFields: FieldDefinitionNode[] = [];

        for (const field of typeNode.fields || []) {
          const fieldName = field.name.value;
          const hasExternal = getDirectiveByName(field, 'external');
          if (!existingFields.has(fieldName) && !hasExternal) {
            newFields.push(field);
          } else if (existingFields.has(fieldName) && !hasExternal) {
            const existingField = existingFields.get(fieldName)!;
            const existingHasExternal = getDirectiveByName(existingField, 'external');
            if (existingHasExternal) {
              const idx = existing.fields?.findIndex(f => f.name.value === fieldName) ?? -1;
              if (idx >= 0 && existing.fields) {
                const newFieldsArr = [...existing.fields];
                newFieldsArr[idx] = field;
                mergedTypes.set(name, {
                  ...existing,
                  fields: newFieldsArr,
                });
              }
            }
          }
        }

        if (newFields.length > 0) {
          mergedTypes.set(name, {
            ...existing,
            fields: [...(existing.fields || []), ...newFields],
          });
        }

        const existingDirectives = new Map(existing.directives?.map(d => [d.name.value + JSON.stringify(d.arguments), d]) || []);
        const newDirectives = typeNode.directives?.filter(d => {
          const key = d.name.value + JSON.stringify(d.arguments);
          return !existingDirectives.has(key);
        }) || [];
        if (newDirectives.length > 0) {
          const merged = mergedTypes.get(name)!;
          mergedTypes.set(name, {
            ...merged,
            directives: [...(merged.directives || []), ...newDirectives],
          });
        }
      }
    }
  }

  const definitions: DefinitionNode[] = [];

  for (const scalar of mergedScalars.values()) {
    definitions.push(scalar);
  }
  for (const enumNode of mergedEnums.values()) {
    definitions.push(enumNode);
  }
  for (const iface of mergedInterfaces.values()) {
    definitions.push(iface);
  }
  for (const union of mergedUnions.values()) {
    definitions.push(union);
  }
  for (const input of mergedInputs.values()) {
    definitions.push(input);
  }
  for (const type of mergedTypes.values()) {
    definitions.push(type);
  }

  return {
    kind: 'Document' as any,
    definitions,
  };
}

export function composeSchemas(subgraphs: SubgraphSchema[]): CompositionResult {
  const errors: CompositionError[] = [];
  const warnings: CompositionWarning[] = [];

  if (subgraphs.length === 0) {
    return {
      success: false,
      errors: [{ subgraph: 'system', message: 'No subgraphs provided for composition.' }],
      warnings: [],
      breakingChanges: [],
    };
  }

  const parsedSubgraphs: ParsedSubgraph[] = [];
  for (const sg of subgraphs) {
    try {
      parsedSubgraphs.push(parseSubgraph(sg));
    } catch (err: any) {
      errors.push({
        subgraph: sg.name,
        message: `Failed to parse schema: ${err.message}`,
      });
    }
  }

  if (errors.length > 0) {
    return {
      success: false,
      errors,
      warnings: [],
      breakingChanges: [],
    };
  }

  errors.push(...validateScalarsConsistency(parsedSubgraphs));
  errors.push(...validateEnumsConsistency(parsedSubgraphs));
  errors.push(...validateFieldTypeConsistency(parsedSubgraphs));
  errors.push(...validateEntityKeys(parsedSubgraphs));

  if (errors.length > 0) {
    return {
      success: false,
      errors,
      warnings,
      breakingChanges: [],
    };
  }

  const mergedDocument = mergeSubgraphs(parsedSubgraphs);
  const supergraphSdl = print(mergedDocument);

  return {
    success: true,
    errors: [],
    warnings,
    breakingChanges: [],
    supergraphSdl,
  };
}

export function detectChanges(oldSdl: string | null, newSdl: string): ChangeSummary {
  const breakingChanges: ChangeItem[] = [];
  const nonBreakingChanges: ChangeItem[] = [];
  const dangerousChanges: ChangeItem[] = [];

  if (!oldSdl) {
    nonBreakingChanges.push({
      type: 'SCHEMA_ADDED',
      description: 'Initial schema version',
    });
    return { breakingChanges, nonBreakingChanges, dangerousChanges };
  }

  let oldDoc: DocumentNode;
  let newDoc: DocumentNode;

  try {
    oldDoc = parse(oldSdl);
  } catch {
    return {
      breakingChanges: [{ type: 'PARSE_ERROR', description: 'Failed to parse old schema' }],
      nonBreakingChanges: [],
      dangerousChanges: [],
    };
  }

  try {
    newDoc = parse(newSdl);
  } catch {
    return {
      breakingChanges: [{ type: 'PARSE_ERROR', description: 'Failed to parse new schema' }],
      nonBreakingChanges: [],
      dangerousChanges: [],
    };
  }

  const oldTypes = new Map<string, ObjectTypeDefinitionNode>();
  const newTypes = new Map<string, ObjectTypeDefinitionNode>();
  const oldEnums = new Map<string, EnumTypeDefinitionNode>();
  const newEnums = new Map<string, EnumTypeDefinitionNode>();
  const oldScalars = new Set<string>();
  const newScalars = new Set<string>();

  for (const def of oldDoc.definitions) {
    if (def.kind === 'ObjectTypeDefinition' && def.name) {
      oldTypes.set(def.name.value, def);
    } else if (def.kind === 'EnumTypeDefinition' && def.name) {
      oldEnums.set(def.name.value, def);
    } else if (def.kind === 'ScalarTypeDefinition' && def.name) {
      oldScalars.add(def.name.value);
    }
  }

  for (const def of newDoc.definitions) {
    if (def.kind === 'ObjectTypeDefinition' && def.name) {
      newTypes.set(def.name.value, def);
    } else if (def.kind === 'EnumTypeDefinition' && def.name) {
      newEnums.set(def.name.value, def);
    } else if (def.kind === 'ScalarTypeDefinition' && def.name) {
      newScalars.add(def.name.value);
    }
  }

  for (const [name, oldType] of oldTypes) {
    if (!newTypes.has(name)) {
      breakingChanges.push({
        type: 'TYPE_REMOVED',
        description: `Type "${name}" was removed`,
        path: name,
      });
      continue;
    }

    const newType = newTypes.get(name)!;
    const oldFields = new Map(oldType.fields?.map(f => [f.name.value, f]) || []);
    const newFields = new Map(newType.fields?.map(f => [f.name.value, f]) || []);

    for (const [fieldName, oldField] of oldFields) {
      if (!newFields.has(fieldName)) {
        breakingChanges.push({
          type: 'FIELD_REMOVED',
          description: `Field "${name}.${fieldName}" was removed`,
          path: `${name}.${fieldName}`,
        });
        continue;
      }

      const newField = newFields.get(fieldName)!;
      const oldTypeStr = print(oldField.type);
      const newTypeStr = print(newField.type);

      if (oldTypeStr !== newTypeStr) {
        const wasOptional = !isNonNullType(oldField.type);
        const isNowRequired = isNonNullType(newField.type);

        if (wasOptional && isNowRequired) {
          breakingChanges.push({
            type: 'FIELD_TYPE_CHANGED_OPTIONAL_TO_REQUIRED',
            description: `Field "${name}.${fieldName}" type changed from ${oldTypeStr} to ${newTypeStr} (optional to required)`,
            path: `${name}.${fieldName}`,
          });
        } else {
          const oldInnerType = getTypeName(oldField.type);
          const newInnerType = getTypeName(newField.type);
          if (oldInnerType !== newInnerType) {
            breakingChanges.push({
              type: 'FIELD_TYPE_CHANGED',
              description: `Field "${name}.${fieldName}" type changed from ${oldTypeStr} to ${newTypeStr}`,
              path: `${name}.${fieldName}`,
            });
          } else {
            dangerousChanges.push({
              type: 'FIELD_TYPE_NULLABILITY_CHANGED',
              description: `Field "${name}.${fieldName}" nullability changed from ${oldTypeStr} to ${newTypeStr}`,
              path: `${name}.${fieldName}`,
            });
          }
        }
      }
    }

    for (const [fieldName] of newFields) {
      if (!oldFields.has(fieldName)) {
        nonBreakingChanges.push({
          type: 'FIELD_ADDED',
          description: `Field "${name}.${fieldName}" was added`,
          path: `${name}.${fieldName}`,
        });
      }
    }
  }

  for (const [name] of newTypes) {
    if (!oldTypes.has(name)) {
      nonBreakingChanges.push({
        type: 'TYPE_ADDED',
        description: `Type "${name}" was added`,
        path: name,
      });
    }
  }

  for (const [name, oldEnum] of oldEnums) {
    if (!newEnums.has(name)) {
      breakingChanges.push({
        type: 'ENUM_REMOVED',
        description: `Enum "${name}" was removed`,
        path: name,
      });
      continue;
    }

    const newEnum = newEnums.get(name)!;
    const oldValues = new Set(oldEnum.values?.map(v => v.name.value) || []);
    const newValues = new Set(newEnum.values?.map(v => v.name.value) || []);

    for (const val of oldValues) {
      if (!newValues.has(val)) {
        breakingChanges.push({
          type: 'ENUM_VALUE_REMOVED',
          description: `Enum value "${name}.${val}" was removed`,
          path: `${name}.${val}`,
        });
      }
    }

    for (const val of newValues) {
      if (!oldValues.has(val)) {
        nonBreakingChanges.push({
          type: 'ENUM_VALUE_ADDED',
          description: `Enum value "${name}.${val}" was added`,
          path: `${name}.${val}`,
        });
      }
    }
  }

  for (const scalar of newScalars) {
    if (!oldScalars.has(scalar)) {
      nonBreakingChanges.push({
        type: 'SCALAR_ADDED',
        description: `Scalar "${scalar}" was added`,
        path: scalar,
      });
    }
  }

  for (const scalar of oldScalars) {
    if (!newScalars.has(scalar)) {
      breakingChanges.push({
        type: 'SCALAR_REMOVED',
        description: `Scalar "${scalar}" was removed`,
        path: scalar,
      });
    }
  }

  return { breakingChanges, nonBreakingChanges, dangerousChanges };
}

export function validateSchemaSize(sdl: string, maxKb: number): { valid: boolean; sizeBytes: number } {
  const sizeBytes = Buffer.byteLength(sdl, 'utf8');
  return {
    valid: sizeBytes <= maxKb * 1024,
    sizeBytes,
  };
}

export default {
  composeSchemas,
  detectChanges,
  parseSubgraph,
  validateSchemaSize,
};
