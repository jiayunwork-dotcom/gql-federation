import { query } from '../db';
import { cacheGet, cacheSet } from '../cache';
import { SupergraphInfo, SubgraphInfo, TenantConfig } from '../types';
import { parse, DocumentNode, ObjectTypeDefinitionNode, DirectiveNode, visit, print } from 'graphql';

const SUPERGRAPH_CACHE_KEY = 'gateway:supergraph:';
const TENANT_CACHE_KEY = 'gateway:tenant:';

export async function getTenantConfig(tenantName: string): Promise<TenantConfig | null> {
  const cacheKey = TENANT_CACHE_KEY + tenantName;
  const cached = await cacheGet<TenantConfig>(cacheKey);
  if (cached) return cached;

  const result = await query<any>(
    'SELECT id, name, max_query_depth, max_complexity FROM tenants WHERE name = $1 AND is_active = true',
    [tenantName]
  );

  if (result.rows.length === 0) return null;

  const tenant: TenantConfig = {
    id: result.rows[0].id,
    name: result.rows[0].name,
    maxQueryDepth: result.rows[0].max_query_depth,
    maxComplexity: result.rows[0].max_complexity,
  };

  await cacheSet(cacheKey, tenant, 300);
  return tenant;
}

export async function getCurrentSupergraph(tenantId: string): Promise<SupergraphInfo | null> {
  const cacheKey = SUPERGRAPH_CACHE_KEY + tenantId + ':current';
  const cached = await cacheGet<SupergraphInfo>(cacheKey);
  if (cached) return cached;

  const result = await query<any>(
    `SELECT sv.* 
     FROM supergraph_versions sv
     WHERE sv.tenant_id = $1 AND sv.status IN ('active', 'grayscale')
     ORDER BY sv.version DESC
     LIMIT 1`,
    [tenantId]
  );

  if (result.rows.length === 0) return null;

  const supergraphVersion = result.rows[0];
  const subgraphVersions = supergraphVersion.subgraph_versions || [];

  const subgraphs: SubgraphInfo[] = [];
  for (const svRef of subgraphVersions) {
    const sgResult = await query<any>(
      `SELECT s.id, s.name, s.routing_url, sv.sdl
       FROM subgraphs s
       JOIN schema_versions sv ON sv.id = $1
       WHERE s.id = $2 AND s.is_active = true`,
      [svRef.versionId, svRef.subgraphId]
    );

    if (sgResult.rows.length > 0) {
      subgraphs.push({
        id: sgResult.rows[0].id,
        name: sgResult.rows[0].name,
        routingUrl: sgResult.rows[0].routing_url,
        sdl: sgResult.rows[0].sdl,
      });
    }
  }

  const supergraph: SupergraphInfo = {
    id: supergraphVersion.id,
    version: supergraphVersion.version,
    sdl: supergraphVersion.sdl,
    status: supergraphVersion.status,
    subgraphs,
  };

  await cacheSet(cacheKey, supergraph, 60);
  return supergraph;
}

export interface FieldOwnershipMap {
  [typeName: string]: {
    [fieldName: string]: string;
  };
}

export interface EntityKeyMap {
  [typeName: string]: {
    fields: string[];
    subgraphs: string[];
  };
}

export function buildFieldOwnershipMap(subgraphs: SubgraphInfo[]): FieldOwnershipMap {
  const ownership: FieldOwnershipMap = {};

  for (const sg of subgraphs) {
    let document: DocumentNode;
    try {
      document = parse(sg.sdl);
    } catch {
      continue;
    }

    visit(document, {
      ObjectTypeDefinition(node) {
        const typeName = node.name.value;
        if (!ownership[typeName]) {
          ownership[typeName] = {};
        }

        for (const field of node.fields || []) {
          const fieldName = field.name.value;
          const hasExternal = node.directives?.some(d => d.name.value === 'external');
          const fieldHasExternal = field.directives?.some(d => d.name.value === 'external');
          
          if (!fieldHasExternal) {
            if (!ownership[typeName][fieldName]) {
              ownership[typeName][fieldName] = sg.name;
            }
          }
        }
      },
    });
  }

  return ownership;
}

export function buildEntityKeyMap(subgraphs: SubgraphInfo[]): EntityKeyMap {
  const entities: EntityKeyMap = {};

  for (const sg of subgraphs) {
    let document: DocumentNode;
    try {
      document = parse(sg.sdl);
    } catch {
      continue;
    }

    visit(document, {
      ObjectTypeDefinition(node) {
        const keyDirectives = node.directives?.filter(d => d.name.value === 'key') || [];
        if (keyDirectives.length === 0) return;

        const typeName = node.name.value;
        const keyFields = new Set<string>();

        for (const keyDir of keyDirectives) {
          const fieldsArg = keyDir.arguments?.find(a => a.name.value === 'fields');
          if (fieldsArg && fieldsArg.value.kind === 'StringValue') {
            fieldsArg.value.value.split(/\s+/).filter(Boolean).forEach(f => keyFields.add(f));
          }
        }

        if (!entities[typeName]) {
          entities[typeName] = { fields: [...keyFields], subgraphs: [] };
        } else {
          for (const f of keyFields) {
            if (!entities[typeName].fields.includes(f)) {
              entities[typeName].fields.push(f);
            }
          }
        }
        entities[typeName].subgraphs.push(sg.name);
      },
    });
  }

  return entities;
}

export function getQueryType(subgraphs: SubgraphInfo[]): string {
  for (const sg of subgraphs) {
    let document: DocumentNode;
    try {
      document = parse(sg.sdl);
    } catch {
      continue;
    }

    for (const def of document.definitions) {
      if (def.kind === 'ObjectTypeDefinition' && def.name.value === 'Query') {
        return 'Query';
      }
    }
  }
  return 'Query';
}

export default {
  getTenantConfig,
  getCurrentSupergraph,
  buildFieldOwnershipMap,
  buildEntityKeyMap,
};
