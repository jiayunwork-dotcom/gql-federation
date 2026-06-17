import { parse, print, DocumentNode, ObjectTypeDefinitionNode, FieldDefinitionNode, NameNode, NonNullTypeNode, NamedTypeNode, ListTypeNode } from 'graphql';
import { SchemaDiffResult, SchemaDiffLine, SchemaDiffPreview, CompatibilityCheckResult, CompatibilityCheckItem, CompatibilityLevel, DiffStats } from '../types';
import { getSchemaVersionById, getSchemaVersions } from './subgraph-service';

interface TypeBlock {
  name: string;
  kind: string;
  startLine: number;
  endLine: number;
  content: string;
  fields: Map<string, { typeStr: string; fullLine: string }>;
}

function extractTypeBlocks(sdl: string): TypeBlock[] {
  const lines = sdl.split('\n');
  const blocks: TypeBlock[] = [];
  let currentBlock: TypeBlock | null = null;
  let braceDepth = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();

    if (!trimmed || trimmed.startsWith('#') || trimmed.startsWith('"""')) continue;

    const typeMatch = trimmed.match(/^(type|input|interface|enum|union|scalar)\s+(\w+)/);
    if (typeMatch && braceDepth === 0) {
      currentBlock = {
        name: typeMatch[2],
        kind: typeMatch[1],
        startLine: i + 1,
        endLine: i + 1,
        content: '',
        fields: new Map(),
      };
      braceDepth += (line.match(/{/g) || []).length;
      braceDepth -= (line.match(/}/g) || []).length;

      if (typeMatch[1] === 'scalar' || typeMatch[1] === 'union') {
        currentBlock.endLine = i + 1;
        currentBlock.content = line;
        blocks.push(currentBlock);
        currentBlock = null;
        braceDepth = 0;
      }
      continue;
    }

    if (currentBlock) {
      braceDepth += (line.match(/{/g) || []).length;
      braceDepth -= (line.match(/}/g) || []).length;

      if (trimmed && !trimmed.startsWith('#') && !trimmed.startsWith('}') && trimmed !== '{') {
        const fieldMatch = trimmed.match(/^(\w+)(\s*\(.*?\))?\s*:\s*(.+?)(\s*@.*)?$/);
        if (fieldMatch) {
          currentBlock.fields.set(fieldMatch[1], {
            typeStr: fieldMatch[3].trim(),
            fullLine: trimmed,
          });
        }
      }

      if (braceDepth <= 0) {
        currentBlock.endLine = i + 1;
        const blockLines = lines.slice(currentBlock.startLine - 1, i + 1);
        currentBlock.content = blockLines.join('\n');
        blocks.push(currentBlock);
        currentBlock = null;
        braceDepth = 0;
      }
    }
  }

  return blocks;
}

function computeLineDiff(leftSdl: string, rightSdl: string): { leftLines: SchemaDiffLine[]; rightLines: SchemaDiffLine[]; typeSections: SchemaDiffResult['typeSections'] } {
  const leftBlocks = extractTypeBlocks(leftSdl);
  const rightBlocks = extractTypeBlocks(rightSdl);

  const leftBlockMap = new Map(leftBlocks.map(b => [b.name, b]));
  const rightBlockMap = new Map(rightBlocks.map(b => [b.name, b]));

  const leftLines: SchemaDiffLine[] = leftSdl.split('\n').map((content, i) => ({
    lineNumber: i + 1,
    content,
    type: 'unchanged' as SchemaDiffLine['type'],
  }));

  const rightLines: SchemaDiffLine[] = rightSdl.split('\n').map((content, i) => ({
    lineNumber: i + 1,
    content,
    type: 'unchanged' as SchemaDiffLine['type'],
  }));

  const allTypeNames = new Set([...leftBlockMap.keys(), ...rightBlockMap.keys()]);
  const typeSections: SchemaDiffResult['typeSections'] = [];

  for (const typeName of allTypeNames) {
    const leftBlock = leftBlockMap.get(typeName);
    const rightBlock = rightBlockMap.get(typeName);

    typeSections.push({
      typeName,
      leftRange: leftBlock ? { start: leftBlock.startLine, end: leftBlock.endLine } : { start: 0, end: 0 },
      rightRange: rightBlock ? { start: rightBlock.startLine, end: rightBlock.endLine } : { start: 0, end: 0 },
    });

    if (!rightBlock && leftBlock) {
      for (let i = leftBlock.startLine - 1; i < leftBlock.endLine; i++) {
        if (i < leftLines.length) {
          leftLines[i] = { ...leftLines[i], type: 'removed', typeName };
        }
      }
    } else if (!leftBlock && rightBlock) {
      for (let i = rightBlock.startLine - 1; i < rightBlock.endLine; i++) {
        if (i < rightLines.length) {
          rightLines[i] = { ...rightLines[i], type: 'added', typeName };
        }
      }
    } else if (leftBlock && rightBlock) {
      const leftFieldMap = leftBlock.fields;
      const rightFieldMap = rightBlock.fields;

      const leftSdlLines = leftSdl.split('\n');
      const rightSdlLines = rightSdl.split('\n');

      for (const [fieldName, leftField] of leftFieldMap) {
        if (!rightFieldMap.has(fieldName)) {
          for (let i = leftBlock.startLine - 1; i < leftBlock.endLine; i++) {
            if (i < leftSdlLines.length && leftSdlLines[i].trim().startsWith(fieldName)) {
              leftLines[i] = { ...leftLines[i], type: 'removed', typeName };
            }
          }
        } else {
          const rightField = rightFieldMap.get(fieldName)!;
          if (leftField.typeStr !== rightField.typeStr) {
            for (let i = leftBlock.startLine - 1; i < leftBlock.endLine; i++) {
              if (i < leftSdlLines.length && leftSdlLines[i].trim().startsWith(fieldName)) {
                leftLines[i] = { ...leftLines[i], type: 'modified', typeName };
              }
            }
            for (let i = rightBlock.startLine - 1; i < rightBlock.endLine; i++) {
              if (i < rightSdlLines.length && rightSdlLines[i].trim().startsWith(fieldName)) {
                rightLines[i] = { ...rightLines[i], type: 'modified', typeName };
              }
            }
          }
        }
      }

      for (const [fieldName] of rightFieldMap) {
        if (!leftFieldMap.has(fieldName)) {
          for (let i = rightBlock.startLine - 1; i < rightBlock.endLine; i++) {
            if (i < rightSdlLines.length && rightSdlLines[i].trim().startsWith(fieldName)) {
              rightLines[i] = { ...rightLines[i], type: 'added', typeName };
            }
          }
        }
      }
    }
  }

  return { leftLines, rightLines, typeSections };
}

function computeStructuredSummary(leftSdl: string, rightSdl: string): SchemaDiffResult['structuredSummary'] {
  const summary: SchemaDiffResult['structuredSummary'] = {
    addedTypes: [],
    removedTypes: [],
    addedFields: [],
    removedFields: [],
    typeChanges: [],
  };

  let leftDoc: DocumentNode;
  let rightDoc: DocumentNode;

  try {
    leftDoc = parse(leftSdl);
    rightDoc = parse(rightSdl);
  } catch {
    return summary;
  }

  const leftTypes = new Map<string, ObjectTypeDefinitionNode>();
  const rightTypes = new Map<string, ObjectTypeDefinitionNode>();
  const leftAllNames = new Set<string>();
  const rightAllNames = new Set<string>();

  for (const def of leftDoc.definitions) {
    const nameNode = (def as any).name as NameNode | undefined;
    if (nameNode) {
      leftAllNames.add(nameNode.value);
      if (def.kind === 'ObjectTypeDefinition') {
        leftTypes.set(nameNode.value, def as ObjectTypeDefinitionNode);
      }
    }
  }

  for (const def of rightDoc.definitions) {
    const nameNode = (def as any).name as NameNode | undefined;
    if (nameNode) {
      rightAllNames.add(nameNode.value);
      if (def.kind === 'ObjectTypeDefinition') {
        rightTypes.set(nameNode.value, def as ObjectTypeDefinitionNode);
      }
    }
  }

  for (const name of rightAllNames) {
    if (!leftAllNames.has(name)) {
      summary.addedTypes.push(name);
    }
  }

  for (const name of leftAllNames) {
    if (!rightAllNames.has(name)) {
      summary.removedTypes.push(name);
    }
  }

  for (const [name, leftDef] of leftTypes) {
    const rightDef = rightTypes.get(name);
    if (!rightDef) continue;

    const leftFields = new Map(
      (leftDef.fields || []).map((f: FieldDefinitionNode) => [f.name.value, f])
    );
    const rightFields = new Map(
      (rightDef.fields || []).map((f: FieldDefinitionNode) => [f.name.value, f])
    );

    for (const fieldName of rightFields.keys()) {
      if (!leftFields.has(fieldName)) {
        summary.addedFields.push(`${name}.${fieldName}`);
      }
    }

    for (const [fieldName, leftField] of leftFields) {
      if (!rightFields.has(fieldName)) {
        summary.removedFields.push(`${name}.${fieldName}`);
      } else {
        const rightField = rightFields.get(fieldName)!;
        const leftTypeStr = print(leftField.type);
        const rightTypeStr = print(rightField.type);
        if (leftTypeStr !== rightTypeStr) {
          summary.typeChanges.push({
            path: `${name}.${fieldName}`,
            fromType: leftTypeStr,
            toType: rightTypeStr,
          });
        }
      }
    }
  }

  return summary;
}

export async function computeSchemaDiff(
  leftVersionId: string,
  rightVersionId: string
): Promise<SchemaDiffResult> {
  const leftVersion = await getSchemaVersionById(leftVersionId);
  const rightVersion = await getSchemaVersionById(rightVersionId);

  if (!leftVersion) {
    throw new Error('Left version not found');
  }
  if (!rightVersion) {
    throw new Error('Right version not found');
  }

  const leftSdl = String(leftVersion.sdl || '');
  const rightSdl = String(rightVersion.sdl || '');

  if (!leftSdl.trim()) {
    throw new Error('Left version SDL is empty');
  }
  if (!rightSdl.trim()) {
    throw new Error('Right version SDL is empty');
  }

  const { leftLines, rightLines, typeSections } = computeLineDiff(leftSdl, rightSdl);
  const structuredSummary = computeStructuredSummary(leftSdl, rightSdl);

  return {
    leftLines: leftLines.map(l => ({
      lineNumber: l.lineNumber,
      content: String(l.content ?? ''),
      type: l.type,
      typeName: l.typeName,
    })),
    rightLines: rightLines.map(l => ({
      lineNumber: l.lineNumber,
      content: String(l.content ?? ''),
      type: l.type,
      typeName: l.typeName,
    })),
    structuredSummary,
    typeSections,
  };
}

export async function getDiffableVersions(subgraphId: string): Promise<Array<{ id: string; version: number; publishedAt: string; publishedBy?: string }>> {
  const versions = await getSchemaVersions(subgraphId, 100);
  return versions.map(v => ({
    id: v.id,
    version: v.version,
    publishedAt: v.published_at instanceof Date ? v.published_at.toISOString() : String(v.published_at),
    publishedBy: v.published_by,
  }));
}

function isDeprecatedField(field: FieldDefinitionNode): boolean {
  return field.directives?.some(d => d.name.value === 'deprecated') || false;
}

function isNonNullType(type: any): boolean {
  return type.kind === 'NonNullType';
}

function hasDefaultValue(field: FieldDefinitionNode): boolean {
  if (!field.arguments) return false;
  return field.arguments.some(arg => arg.defaultValue !== undefined);
}

function getTypeDefinitionNames(doc: DocumentNode): Set<string> {
  const names = new Set<string>();
  for (const def of doc.definitions) {
    const nameNode = (def as any).name as NameNode | undefined;
    if (nameNode) {
      names.add(nameNode.value);
    }
  }
  return names;
}

export function checkCompatibility(
  oldSdl: string,
  newSdl: string
): CompatibilityCheckResult {
  const items: CompatibilityCheckItem[] = [];

  let oldDoc: DocumentNode;
  let newDoc: DocumentNode;

  try {
    oldDoc = parse(oldSdl);
    newDoc = parse(newSdl);
  } catch {
    return {
      items: [{
        type: 'PARSE_ERROR',
        description: 'SDL解析失败，无法进行兼容性检测',
        level: 'WARNING',
      }],
      hasBreakingChanges: false,
      breakingCount: 0,
      compatibleCount: 0,
      warningCount: 1,
    };
  }

  const oldTypes = new Map<string, ObjectTypeDefinitionNode>();
  const newTypes = new Map<string, ObjectTypeDefinitionNode>();
  const oldAllNames = getTypeDefinitionNames(oldDoc);
  const newAllNames = getTypeDefinitionNames(newDoc);

  for (const def of oldDoc.definitions) {
    const nameNode = (def as any).name as NameNode | undefined;
    if (nameNode && def.kind === 'ObjectTypeDefinition') {
      oldTypes.set(nameNode.value, def as ObjectTypeDefinitionNode);
    }
  }

  for (const def of newDoc.definitions) {
    const nameNode = (def as any).name as NameNode | undefined;
    if (nameNode && def.kind === 'ObjectTypeDefinition') {
      newTypes.set(nameNode.value, def as ObjectTypeDefinitionNode);
    }
  }

  for (const typeName of oldAllNames) {
    if (!newAllNames.has(typeName)) {
      items.push({
        type: 'TYPE_REMOVED',
        description: `移除了类型 ${typeName}`,
        path: typeName,
        level: 'BREAKING',
      });
    }
  }

  for (const [typeName, oldDef] of oldTypes) {
    const newDef = newTypes.get(typeName);
    if (!newDef) continue;

    const oldFields = new Map(
      (oldDef.fields || []).map((f: FieldDefinitionNode) => [f.name.value, f])
    );
    const newFields = new Map(
      (newDef.fields || []).map((f: FieldDefinitionNode) => [f.name.value, f])
    );

    for (const [fieldName, oldField] of oldFields) {
      if (!newFields.has(fieldName)) {
        const isDeprecated = isDeprecatedField(oldField);
        items.push({
          type: isDeprecated ? 'DEPRECATED_FIELD_REMOVED' : 'FIELD_REMOVED',
          description: `移除了字段 ${typeName}.${fieldName}${isDeprecated ? '（已废弃）' : ''}`,
          path: `${typeName}.${fieldName}`,
          level: isDeprecated ? 'COMPATIBLE' : 'BREAKING',
        });
      } else {
        const newField = newFields.get(fieldName)!;
        const oldTypeStr = print(oldField.type);
        const newTypeStr = print(newField.type);

        if (oldTypeStr !== newTypeStr) {
          items.push({
            type: 'FIELD_TYPE_CHANGED',
            description: `字段 ${typeName}.${fieldName} 类型从 ${oldTypeStr} 改为 ${newTypeStr}`,
            path: `${typeName}.${fieldName}`,
            level: 'BREAKING',
          });
        }
      }
    }

    for (const [fieldName, newField] of newFields) {
      if (!oldFields.has(fieldName)) {
        const isRequired = isNonNullType(newField.type) && !hasDefaultValue(newField);
        items.push({
          type: isRequired ? 'REQUIRED_FIELD_ADDED' : 'OPTIONAL_FIELD_ADDED',
          description: `新增了${isRequired ? '必填' : '可选'}字段 ${typeName}.${fieldName}: ${print(newField.type)}`,
          path: `${typeName}.${fieldName}`,
          level: isRequired ? 'BREAKING' : 'COMPATIBLE',
        });
      }
    }
  }

  const breakingCount = items.filter(i => i.level === 'BREAKING').length;
  const compatibleCount = items.filter(i => i.level === 'COMPATIBLE').length;
  const warningCount = items.filter(i => i.level === 'WARNING').length;

  return {
    items,
    hasBreakingChanges: breakingCount > 0,
    breakingCount,
    compatibleCount,
    warningCount,
  };
}

export function computeDiffPreview(
  oldSdl: string,
  newSdl: string
): SchemaDiffPreview {
  const { leftLines, rightLines } = computeLineDiff(oldSdl, newSdl);
  const compatibility = checkCompatibility(oldSdl, newSdl);

  const stats: DiffStats = {
    added: rightLines.filter(l => l.type === 'added').length,
    removed: leftLines.filter(l => l.type === 'removed').length,
    modified: rightLines.filter(l => l.type === 'modified').length,
  };

  return {
    leftLines: leftLines.map(l => ({
      lineNumber: l.lineNumber,
      content: String(l.content ?? ''),
      type: l.type,
    })),
    rightLines: rightLines.map(l => ({
      lineNumber: l.lineNumber,
      content: String(l.content ?? ''),
      type: l.type,
    })),
    stats,
    compatibility,
  };
}

export default {
  computeSchemaDiff,
  getDiffableVersions,
  checkCompatibility,
  computeDiffPreview,
};
