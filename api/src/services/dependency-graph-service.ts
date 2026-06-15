import { parse, visit, DocumentNode, ObjectTypeDefinitionNode, FieldDefinitionNode, DirectiveNode, StringValueNode } from 'graphql';
import { DependencyGraph, DependencyEdge } from '../types';
import { getActiveSubgraphsWithSchema } from './subgraph-service';
import { query } from '../db';

interface EntityOwnership {
  entityName: string;
  definingSubgraph: string;
}

interface EntityReference {
  sourceSubgraph: string;
  targetSubgraph: string;
  entityName: string;
  fields: string[];
}

function getDirectiveArgValue(directive: DirectiveNode, argName: string): string | undefined {
  const arg = directive.arguments?.find(a => a.name.value === argName);
  if (arg && arg.value.kind === 'StringValue') {
    return (arg.value as StringValueNode).value;
  }
  return undefined;
}

function extractEntityOwnership(sdl: string, subgraphName: string): EntityOwnership[] {
  const ownerships: EntityOwnership[] = [];
  let document: DocumentNode;

  try {
    document = parse(sdl);
  } catch {
    return ownerships;
  }

  visit(document, {
    ObjectTypeDefinition(node) {
      const keyDirective = node.directives?.find(d => d.name.value === 'key');
      if (keyDirective) {
        const hasExternalFields = node.fields?.some(field =>
          field.directives?.some(d => d.name.value === 'external')
        );
        if (!hasExternalFields || node.directives?.some(d => d.name.value === 'key')) {
          const isExtension = node.directives?.some(d => d.name.value === 'key') && hasExternalFields;
          if (!isExtension) {
            ownerships.push({
              entityName: node.name.value,
              definingSubgraph: subgraphName,
            });
          }
        }
      }
    },
  });

  visit(document, {
    ObjectTypeDefinition(node) {
      const keyDirectives = node.directives?.filter(d => d.name.value === 'key') || [];
      if (keyDirectives.length === 0) return;

      const externalFields = node.fields?.filter(field =>
        field.directives?.some(d => d.name.value === 'external')
      ) || [];

      if (externalFields.length > 0) {
        const hasOnlyKeyAndExternal = node.fields?.every(field =>
          field.directives?.some(d => d.name.value === 'external') ||
          field.directives?.some(d => d.name.value === 'key' || d.name.value === 'requires')
        );

        if (hasOnlyKeyAndExternal) {
          return;
        }
      }
    },
  });

  return ownerships;
}

function extractEntityReferences(sdl: string, subgraphName: string): EntityReference[] {
  const references: EntityReference[] = [];
  let document: DocumentNode;

  try {
    document = parse(sdl);
  } catch {
    return references;
  }

  const entityToDefiningSubgraph = new Map<string, string>();

  visit(document, {
    ObjectTypeDefinition(node) {
      const keyDirective = node.directives?.find(d => d.name.value === 'key');
      if (keyDirective) {
        const hasOnlyKey = !node.fields?.some(field =>
          field.directives?.some(d => d.name.value === 'external')
        );
        if (hasOnlyKey) {
          entityToDefiningSubgraph.set(node.name.value, subgraphName);
        }
      }
    },
  });

  visit(document, {
    ObjectTypeDefinition(node) {
      const keyDirective = node.directives?.find(d => d.name.value === 'key');
      if (!keyDirective) return;

      const entityName = node.name.value;

      const externalFields: string[] = [];
      node.fields?.forEach(field => {
        if (field.directives?.some(d => d.name.value === 'external')) {
          externalFields.push(field.name.value);
        }
      });

      const nonLocalFields: string[] = [];
      node.fields?.forEach(field => {
        const hasRequires = field.directives?.some(d => d.name.value === 'requires');
        if (hasRequires) {
          const requiresDirective = field.directives!.find(d => d.name.value === 'requires')!;
          const fieldsArg = getDirectiveArgValue(requiresDirective, 'fields');
          if (fieldsArg) {
            fieldsArg.split(/\s+/).filter(Boolean).forEach(f => {
              if (!nonLocalFields.includes(f)) nonLocalFields.push(f);
            });
          }
        }
      });

      const referencedFields = [...new Set([...externalFields, ...nonLocalFields])];

      if (externalFields.length > 0 && entityToDefiningSubgraph.get(entityName) !== subgraphName) {
        references.push({
          sourceSubgraph: subgraphName,
          targetSubgraph: '',
          entityName,
          fields: referencedFields,
        });
      }
    },
  });

  return references;
}

export async function buildDependencyGraph(tenantId: string): Promise<DependencyGraph> {
  const activeSubgraphs = await getActiveSubgraphsWithSchema(tenantId);

  const healthResult = await query<any>(
    `SELECT DISTINCT ON (subgraph_id) subgraph_id, subgraph_name,
            CASE WHEN error_rate > 5 THEN 'unhealthy'
                 WHEN error_rate > 1 THEN 'degraded'
                 ELSE 'healthy' END as health
     FROM subgraph_health
     WHERE tenant_id = $1
     ORDER BY subgraph_id, window_end DESC`,
    [tenantId]
  );

  const healthMap = new Map<string, string>();
  healthResult.rows.forEach((row: any) => {
    healthMap.set(row.subgraph_id, row.health);
  });

  const nodes = activeSubgraphs.map(({ subgraph, version }) => ({
    id: subgraph.id,
    name: subgraph.name,
    owner: subgraph.owner_team,
    latestVersion: version?.version || 0,
    health: healthMap.get(subgraph.id) || 'unknown',
  }));

  const entityOwnershipMap = new Map<string, string>();

  for (const { subgraph, version } of activeSubgraphs) {
    if (!version) continue;
    const ownerships = extractEntityOwnership(version.sdl, subgraph.name);
    for (const o of ownerships) {
      entityOwnershipMap.set(o.entityName, o.definingSubgraph);
    }
  }

  const edgeMap = new Map<string, DependencyEdge>();

  for (const { subgraph, version } of activeSubgraphs) {
    if (!version) continue;
    const refs = extractEntityReferences(version.sdl, subgraph.name);

    for (const ref of refs) {
      const definingSubgraph = entityOwnershipMap.get(ref.entityName) || ref.targetSubgraph;
      if (!definingSubgraph || definingSubgraph === subgraph.name) continue;

      const edgeKey = `${subgraph.name}->${definingSubgraph}`;
      if (edgeMap.has(edgeKey)) {
        const edge = edgeMap.get(edgeKey)!;
        if (!edge.entities.includes(ref.entityName)) {
          edge.entities.push(ref.entityName);
        }
        edge.fields[ref.entityName] = ref.fields;
      } else {
        edgeMap.set(edgeKey, {
          source: subgraph.name,
          target: definingSubgraph,
          entities: [ref.entityName],
          fields: { [ref.entityName]: ref.fields },
        });
      }
    }
  }

  return {
    nodes,
    edges: Array.from(edgeMap.values()),
  };
}

export default {
  buildDependencyGraph,
};
