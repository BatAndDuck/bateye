import { ServiceDesignDoc, ArchitectureGraph, GraphNode, GraphEdge, SystemDesignResult } from '../../types/index';

export function buildGraph(result: SystemDesignResult): ArchitectureGraph {
  const nodes: GraphNode[] = result.services.map(s => ({
    id: s.serviceId,
    label: s.name,
    kind: s.kind,
    data: s,
  }));

  const edges: GraphEdge[] = [];
  const serviceIds = new Set(result.services.map(s => s.serviceId));

  // Build edges from dependencies
  for (const service of result.services) {
    for (const dep of service.dependencies) {
      // Try to match dependency name to a service
      const targetService = result.services.find(s =>
        s.serviceId === dep ||
        s.name.toLowerCase() === dep.toLowerCase() ||
        s.serviceId.toLowerCase().includes(dep.toLowerCase()) ||
        dep.toLowerCase().includes(s.serviceId.toLowerCase())
      );
      if (targetService && targetService.serviceId !== service.serviceId) {
        const edgeId = `${service.serviceId}->${targetService.serviceId}`;
        if (!edges.find(e => e.id === edgeId)) {
          edges.push({
            id: edgeId,
            source: service.serviceId,
            target: targetService.serviceId,
            label: 'depends on',
            type: 'dependency',
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
