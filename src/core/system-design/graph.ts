import { ServiceDesignDoc, ArchitectureGraph, GraphNode, GraphEdge, SystemDesignResult } from '../../types/index';

export function buildGraph(result: SystemDesignResult): ArchitectureGraph {
  const nodes: GraphNode[] = result.services.map(s => ({
    id: s.serviceId,
    label: s.name,
    kind: s.kind,
    data: s,
  }));

  const edges: GraphEdge[] = [];
  const edgeIds = new Set<string>();

  for (const service of result.services) {
    for (const dep of service.dependencies) {
      const targetService = findMatchingService(result.services, dep);
      if (targetService && targetService.serviceId !== service.serviceId) {
        const edgeId = `${service.serviceId}->${targetService.serviceId}`;
        if (!edgeIds.has(edgeId)) {
          edgeIds.add(edgeId);
          edges.push({
            id: edgeId,
            source: service.serviceId,
            target: targetService.serviceId,
            label: buildEdgeLabel(targetService),
            type: inferEdgeType(targetService),
          });
        }
      }
    }
  }

  return {
    nodes,
    edges,
    metadata: {
      architectureType: result.architectureType,
      score: result.score,
      strengths: result.strengths,
      weaknesses: result.weaknesses,
      globalSummary: result.globalSummary,
      generatedAt: result.generatedAt,
    },
  };
}

function findMatchingService(services: ServiceDesignDoc[], dependency: string): ServiceDesignDoc | undefined {
  const normalizedDependency = normalizeToken(dependency);
  if (!normalizedDependency) return undefined;

  return services.find(service => buildAliases(service).has(normalizedDependency));
}

function buildAliases(service: ServiceDesignDoc): Set<string> {
  const aliases = new Set<string>();
  const values = [service.serviceId, service.name];

  for (const value of values) {
    const normalized = normalizeToken(value);
    if (normalized) aliases.add(normalized);
  }

  const name = `${service.name} ${service.serviceId}`.toLowerCase();
  if (/(frontend|web|client|ui)/.test(name)) ['frontend', 'web', 'client', 'ui'].forEach(alias => aliases.add(alias));
  if (/(api|backend|server)/.test(name)) ['api', 'backend', 'server'].forEach(alias => aliases.add(alias));
  if (/(worker|jobs?|queue|scheduler|cron)/.test(name)) ['worker', 'job', 'jobs', 'queue', 'scheduler'].forEach(alias => aliases.add(alias));
  if (/(gateway|proxy|bff)/.test(name)) ['gateway', 'proxy', 'bff'].forEach(alias => aliases.add(alias));
  if (/(database|db|postgres|postgresql|mysql|mariadb|mongo|mongodb)/.test(name)) {
    ['database', 'db', 'postgres', 'postgresql', 'mysql', 'mariadb', 'mongo', 'mongodb'].forEach(alias => aliases.add(alias));
  }
  if (/(redis|cache)/.test(name)) ['redis', 'cache'].forEach(alias => aliases.add(alias));
  if (/(kafka|rabbitmq|nats|queue|broker)/.test(name)) ['kafka', 'rabbitmq', 'nats', 'broker'].forEach(alias => aliases.add(alias));

  return aliases;
}

function normalizeToken(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '');
}

function inferEdgeType(target: ServiceDesignDoc): GraphEdge['type'] {
  const haystack = `${target.name} ${target.serviceId}`.toLowerCase();

  if (target.kind === 'resource' && /(database|db|postgres|mysql|mongo|redis|cache)/.test(haystack)) {
    return 'db';
  }
  if (target.kind === 'gateway' || /(api|http|gateway|proxy)/.test(haystack)) {
    return 'http';
  }
  if (/(kafka|event|queue|broker|rabbitmq|nats)/.test(haystack)) {
    return 'event';
  }

  return 'dependency';
}

function buildEdgeLabel(target: ServiceDesignDoc): string {
  const edgeType = inferEdgeType(target);
  if (edgeType === 'db') return 'reads/writes';
  if (edgeType === 'http') return 'calls';
  if (edgeType === 'event') return 'publishes/consumes';
  return 'depends on';
}
