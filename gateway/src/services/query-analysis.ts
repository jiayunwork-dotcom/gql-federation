import {
  parse,
  DocumentNode,
  OperationDefinitionNode,
  SelectionSetNode,
  FieldNode,
  FragmentSpreadNode,
  InlineFragmentNode,
  FragmentDefinitionNode,
} from 'graphql';
import { DepthAndComplexityResult, FieldInfo } from '../types';

export function analyzeDepthAndComplexity(
  query: string,
  variables?: any
): DepthAndComplexityResult {
  let document: DocumentNode;
  try {
    document = parse(query);
  } catch (err: any) {
    throw new Error(`Failed to parse query: ${err.message}`);
  }

  const fragments = new Map<string, FragmentDefinitionNode>();
  for (const def of document.definitions) {
    if (def.kind === 'FragmentDefinition') {
      fragments.set(def.name.value, def);
    }
  }

  let maxDepth = 0;
  let totalComplexity = 0;
  const fields: FieldInfo[] = [];
  const fieldsSet = new Set<string>();

  for (const def of document.definitions) {
    if (def.kind === 'OperationDefinition') {
      const result = analyzeSelectionSet(
        def.selectionSet,
        fragments,
        1,
        def.operation === 'mutation' ? 'Mutation' : def.operation === 'subscription' ? 'Subscription' : 'Query',
        fields,
        fieldsSet
      );
      maxDepth = Math.max(maxDepth, result.maxDepth);
      totalComplexity += result.complexity;
    }
  }

  return {
    depth: maxDepth,
    complexity: totalComplexity,
    fields,
  };
}

interface AnalysisResult {
  maxDepth: number;
  complexity: number;
}

function analyzeSelectionSet(
  selectionSet: SelectionSetNode | undefined,
  fragments: Map<string, FragmentDefinitionNode>,
  currentDepth: number,
  parentType: string,
  fields: FieldInfo[],
  fieldsSet: Set<string>
): AnalysisResult {
  if (!selectionSet) {
    return { maxDepth: currentDepth - 1, complexity: 0 };
  }

  let maxDepth = currentDepth;
  let complexity = 0;

  for (const selection of selectionSet.selections) {
    if (selection.kind === 'Field') {
      const field = selection as FieldNode;
      const fieldName = field.name.value;
      
      if (fieldName !== '__typename') {
        const fieldKey = `${parentType}.${fieldName}`;
        if (!fieldsSet.has(fieldKey)) {
          fieldsSet.add(fieldKey);
          fields.push({ typeName: parentType, fieldName });
        }
      }

      const fieldComplexity = calculateFieldComplexity(field, 1);
      complexity += fieldComplexity;

      if (field.selectionSet) {
        const childType = fieldName;
        const childResult = analyzeSelectionSet(
          field.selectionSet,
          fragments,
          currentDepth + 1,
          capitalize(childType),
          fields,
          fieldsSet
        );
        maxDepth = Math.max(maxDepth, childResult.maxDepth);
        complexity += childResult.complexity * fieldComplexity;
      }
    } else if (selection.kind === 'FragmentSpread') {
      const spread = selection as FragmentSpreadNode;
      const fragment = fragments.get(spread.name.value);
      if (fragment) {
        const fragResult = analyzeSelectionSet(
          fragment.selectionSet,
          fragments,
          currentDepth,
          fragment.typeCondition.name.value,
          fields,
          fieldsSet
        );
        maxDepth = Math.max(maxDepth, fragResult.maxDepth);
        complexity += fragResult.complexity;
      }
    } else if (selection.kind === 'InlineFragment') {
      const inline = selection as InlineFragmentNode;
      const fragType = inline.typeCondition?.name.value || parentType;
      const fragResult = analyzeSelectionSet(
        inline.selectionSet,
        fragments,
        currentDepth,
        fragType,
        fields,
        fieldsSet
      );
      maxDepth = Math.max(maxDepth, fragResult.maxDepth);
      complexity += fragResult.complexity;
    }
  }

  return { maxDepth, complexity };
}

function calculateFieldComplexity(field: FieldNode, baseComplexity: number): number {
  let complexity = baseComplexity;

  const hasListDirective = field.directives?.some(d => d.name.value === 'list');
  if (hasListDirective) {
    complexity *= 10;
  }

  const firstArg = field.arguments?.find(a => a.name.value === 'first' || a.name.value === 'limit');
  if (firstArg && firstArg.value.kind === 'IntValue') {
    const limit = parseInt(firstArg.value.value, 10);
    complexity = Math.max(complexity, limit);
  }

  return complexity;
}

function capitalize(str: string): string {
  return str.charAt(0).toUpperCase() + str.slice(1);
}

export function validateQueryDepth(
  query: string,
  maxDepth: number
): { valid: boolean; depth: number; error?: string } {
  try {
    const result = analyzeDepthAndComplexity(query);
    if (result.depth > maxDepth) {
      return {
        valid: false,
        depth: result.depth,
        error: `Query depth ${result.depth} exceeds maximum allowed depth of ${maxDepth}`,
      };
    }
    return { valid: true, depth: result.depth };
  } catch (err: any) {
    return { valid: false, depth: 0, error: err.message };
  }
}

export function validateQueryComplexity(
  query: string,
  maxComplexity: number
): { valid: boolean; complexity: number; error?: string } {
  try {
    const result = analyzeDepthAndComplexity(query);
    if (result.complexity > maxComplexity) {
      return {
        valid: false,
        complexity: result.complexity,
        error: `Query complexity ${result.complexity} exceeds maximum allowed complexity of ${maxComplexity}`,
      };
    }
    return { valid: true, complexity: result.complexity };
  } catch (err: any) {
    return { valid: false, complexity: 0, error: err.message };
  }
}

export default {
  analyzeDepthAndComplexity,
  validateQueryDepth,
  validateQueryComplexity,
};
