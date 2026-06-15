import {
  parse,
  print,
  visit,
  DocumentNode,
  OperationDefinitionNode,
  SelectionSetNode,
  FieldNode,
  FragmentSpreadNode,
  InlineFragmentNode,
  SelectionNode,
  Kind,
  buildSchema,
  GraphQLSchema,
} from 'graphql';
import { createHash } from 'crypto';
import { QueryPlan, QueryPlanStep, SubgraphInfo } from '../types';
import { buildFieldOwnershipMap, buildEntityKeyMap, FieldOwnershipMap, EntityKeyMap } from './supergraph-loader';

export interface QueryPlannerContext {
  subgraphs: SubgraphInfo[];
  fieldOwnership: FieldOwnershipMap;
  entityKeys: EntityKeyMap;
  fragments: Map<string, any>;
}

export function buildQueryPlannerContext(subgraphs: SubgraphInfo[]): QueryPlannerContext {
  return {
    subgraphs,
    fieldOwnership: buildFieldOwnershipMap(subgraphs),
    entityKeys: buildEntityKeyMap(subgraphs),
    fragments: new Map(),
  };
}

export function planQuery(
  query: string,
  context: QueryPlannerContext
): QueryPlan {
  let document: DocumentNode;
  try {
    document = parse(query);
  } catch (err: any) {
    throw new Error(`Failed to parse query: ${err.message}`);
  }

  const fragments = new Map<string, any>();
  for (const def of document.definitions) {
    if (def.kind === 'FragmentDefinition') {
      fragments.set(def.name.value, def);
    }
  }
  context.fragments = fragments;

  const steps: QueryPlanStep[] = [];

  for (const def of document.definitions) {
    if (def.kind === 'OperationDefinition') {
      const operationType = def.operation === 'mutation' ? 'Mutation' : def.operation === 'subscription' ? 'Subscription' : 'Query';
      const rootSteps = planSelectionSet(
        def.selectionSet,
        operationType,
        '',
        context,
        new Set()
      );
      steps.push(...rootSteps);
    }
  }

  const optimizedSteps = optimizeQueryPlan(steps);

  return {
    steps: optimizedSteps,
  };
}

interface FieldGroup {
  subgraphName: string;
  fields: Map<string, FieldNode[]>;
}

function planSelectionSet(
  selectionSet: SelectionSetNode,
  parentType: string,
  pathPrefix: string,
  context: QueryPlannerContext,
  requiredKeys: Set<string>
): QueryPlanStep[] {
  const fieldGroups = new Map<string, { fields: FieldNode[]; subSelections: Map<string, SelectionSetNode> }>();
  const entityFields: Array<{ field: FieldNode; typeName: string }> = [];

  for (const selection of selectionSet.selections) {
    if (selection.kind === 'Field') {
      const field = selection as FieldNode;
      const fieldName = field.name.value;
      
      if (fieldName === '__typename') {
        continue;
      }

      const owningSubgraph = getFieldOwningSubgraph(parentType, fieldName, context);
      
      if (field.selectionSet) {
        const nestedType = capitalize(fieldName);
        const isEntity = context.entityKeys[nestedType];
        
        if (isEntity) {
          entityFields.push({ field, typeName: nestedType });
        } else {
          if (!fieldGroups.has(owningSubgraph)) {
            fieldGroups.set(owningSubgraph, { fields: [], subSelections: new Map() });
          }
          fieldGroups.get(owningSubgraph)!.fields.push(field);
        }
      } else {
        if (!fieldGroups.has(owningSubgraph)) {
          fieldGroups.set(owningSubgraph, { fields: [], subSelections: new Map() });
        }
        fieldGroups.get(owningSubgraph)!.fields.push(field);
      }
    } else if (selection.kind === 'FragmentSpread') {
      const spread = selection as FragmentSpreadNode;
      const fragment = context.fragments.get(spread.name.value);
      if (fragment) {
        const fragType = fragment.typeCondition.name.value;
        const fragSteps = planSelectionSet(fragment.selectionSet, fragType, pathPrefix, context, requiredKeys);
        return fragSteps;
      }
    } else if (selection.kind === 'InlineFragment') {
      const inline = selection as InlineFragmentNode;
      const fragType = inline.typeCondition?.name.value || parentType;
      const inlineSteps = planSelectionSet(inline.selectionSet, fragType, pathPrefix, context, requiredKeys);
      return inlineSteps;
    }
  }

  const steps: QueryPlanStep[] = [];
  let stepId = 0;

  for (const [subgraphName, group] of fieldGroups) {
    const selectionSetStr = buildSelectionSetString(group.fields);
    const step: QueryPlanStep = {
      id: `step-${stepId++}`,
      type: 'fetch',
      subgraphName,
      operation: `query ${selectionSetStr}`,
      selectionSet: selectionSetStr,
      path: pathPrefix,
    };
    steps.push(step);
  }

  for (const { field, typeName } of entityFields) {
    const entitySteps = planEntityField(
      field,
      typeName,
      pathPrefix,
      context,
      stepId
    );
    steps.push(...entitySteps);
    stepId += entitySteps.length;
  }

  return steps;
}

function planEntityField(
  field: FieldNode,
  entityType: string,
  pathPrefix: string,
  context: QueryPlannerContext,
  startStepId: number
): QueryPlanStep[] {
  const steps: QueryPlanStep[] = [];
  const entityKey = context.entityKeys[entityType];
  
  if (!entityKey || entityKey.subgraphs.length <= 1) {
    const subgraphName = entityKey?.subgraphs[0] || getFieldOwningSubgraph(entityType, field.name.value, context);
    const step: QueryPlanStep = {
      id: `step-${startStepId}`,
      type: 'fetch',
      subgraphName,
      entityType,
      keyFields: entityKey?.fields || [],
      selectionSet: field.selectionSet ? printSelectionSet(field.selectionSet) : '',
      path: pathPrefix ? `${pathPrefix}.${field.name.value}` : field.name.value,
    };
    steps.push(step);
    return steps;
  }

  const primarySubgraph = entityKey.subgraphs[0];
  const secondarySubgraphs = entityKey.subgraphs.slice(1);

  const keySelection = entityKey.fields.map(f => ({
    kind: Kind.FIELD,
    name: { kind: Kind.NAME, value: f },
  })) as FieldNode[];

  const primaryStep: QueryPlanStep = {
    id: `step-${startStepId}`,
    type: 'fetch',
    subgraphName: primarySubgraph,
    entityType,
    keyFields: entityKey.fields,
    selectionSet: `{ ${entityKey.fields.join(' ')} }`,
    path: pathPrefix ? `${pathPrefix}.${field.name.value}` : field.name.value,
  };
  steps.push(primaryStep);

  for (let i = 0; i < secondarySubgraphs.length; i++) {
    const subgraphName = secondarySubgraphs[i];
    const entityStep: QueryPlanStep = {
      id: `step-${startStepId + i + 1}`,
      type: 'fetch',
      subgraphName,
      entityType,
      keyFields: entityKey.fields,
      selectionSet: field.selectionSet ? printSelectionSet(field.selectionSet) : '',
      path: pathPrefix ? `${pathPrefix}.${field.name.value}` : field.name.value,
      dependsOn: [primaryStep.id],
    };
    steps.push(entityStep);
  }

  return steps;
}

function printSelectionSet(selectionSet: SelectionSetNode): string {
  const fields: string[] = [];
  for (const selection of selectionSet.selections) {
    if (selection.kind === 'Field') {
      const field = selection as FieldNode;
      let fieldStr = field.name.value;
      if (field.arguments && field.arguments.length > 0) {
        const args = field.arguments.map(arg => `${arg.name.value}: ${printValue(arg.value)}`).join(', ');
        fieldStr += `(${args})`;
      }
      if (field.selectionSet) {
        fieldStr += ` ${printSelectionSet(field.selectionSet)}`;
      }
      fields.push(fieldStr);
    } else if (selection.kind === 'FragmentSpread') {
      fields.push(`...${(selection as FragmentSpreadNode).name.value}`);
    } else if (selection.kind === 'InlineFragment') {
      const inline = selection as InlineFragmentNode;
      const typeCond = inline.typeCondition ? `... on ${inline.typeCondition.name.value}` : '...';
      fields.push(`${typeCond} ${printSelectionSet(inline.selectionSet)}`);
    }
  }
  return `{ ${fields.join(' ')} }`;
}

function printValue(value: any): string {
  if (value.kind === 'StringValue') return JSON.stringify(value.value);
  if (value.kind === 'IntValue') return value.value;
  if (value.kind === 'FloatValue') return value.value;
  if (value.kind === 'BooleanValue') return String(value.value);
  if (value.kind === 'EnumValue') return value.value;
  if (value.kind === 'NullValue') return 'null';
  if (value.kind === 'ListValue') {
    return `[${value.values.map(printValue).join(', ')}]`;
  }
  if (value.kind === 'ObjectValue') {
    const fields = value.fields.map((f: any) => `${f.name.value}: ${printValue(f.value)}`).join(', ');
    return `{ ${fields} }`;
  }
  if (value.kind === 'Variable') return `$${value.name.value}`;
  return String(value);
}

function buildSelectionSetString(fields: FieldNode[]): string {
  const fieldStrs = fields.map(f => {
    let str = f.name.value;
    if (f.selectionSet) {
      str += ` ${printSelectionSet(f.selectionSet)}`;
    }
    return str;
  });
  return `{ ${fieldStrs.join(' ')} }`;
}

function getFieldOwningSubgraph(
  typeName: string,
  fieldName: string,
  context: QueryPlannerContext
): string {
  const typeOwnership = context.fieldOwnership[typeName];
  if (typeOwnership && typeOwnership[fieldName]) {
    return typeOwnership[fieldName];
  }
  if (context.subgraphs.length > 0) {
    return context.subgraphs[0].name;
  }
  return 'unknown';
}

function optimizeQueryPlan(steps: QueryPlanStep[]): QueryPlanStep[] {
  if (steps.length <= 1) return steps;

  const fetchSteps = steps.filter(s => s.type === 'fetch');
  const parallelGroups: Map<string, QueryPlanStep[]> = new Map();

  for (const step of fetchSteps) {
    const subgraph = step.subgraphName || 'unknown';
    if (!parallelGroups.has(subgraph)) {
      parallelGroups.set(subgraph, []);
    }
    parallelGroups.get(subgraph)!.push(step);
  }

  if (parallelGroups.size <= 1) {
    return steps;
  }

  return steps;
}

function capitalize(str: string): string {
  return str.charAt(0).toUpperCase() + str.slice(1);
}

export function getQueryHash(query: string, operationName?: string): string {
  const normalized = query.replace(/\s+/g, ' ').trim();
  return createHash('sha256').update(normalized + (operationName || '')).digest('hex');
}

export default {
  buildQueryPlannerContext,
  planQuery,
  getQueryHash,
};
