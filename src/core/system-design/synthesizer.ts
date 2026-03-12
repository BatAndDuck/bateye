import { ServiceDesignDoc } from '../../types/index';
import { getRuntime } from '../runtime/factory';
import { systemSynthesisSchema, SystemSynthesis } from '../validation/schemas';
import { buildSystemSynthesisSystemPrompt, buildSystemSynthesisUserMessage } from '../prompts/system-design';

export async function synthesizeArchitecture(
  services: ServiceDesignDoc[],
  repoStructure: string,
  model: string,
  apiKey: string,
  coverage?: import('../../types/index').SystemDesignResult['coverage'],
): Promise<SystemSynthesis> {
  const runtime = await getRuntime();
  const systemPrompt = buildSystemSynthesisSystemPrompt();
  const userMessage = buildSystemSynthesisUserMessage(services, repoStructure, coverage);

  try {
    const result = await runtime.run<SystemSynthesis>(
      { systemPrompt, userMessage, model, apiKey, maxTokens: 4096 },
      systemSynthesisSchema
    );
    return result.data;
  } catch {
    const internalUnits = services.filter(service => service.kind !== 'resource');
    const workerCount = internalUnits.filter(service => service.kind === 'worker').length;
    const gatewayCount = internalUnits.filter(service => service.kind === 'gateway').length;
    const appCount = internalUnits.filter(service => service.kind === 'app').length;
    const serviceCount = internalUnits.filter(service => service.kind === 'service').length;
    const libraryCount = internalUnits.filter(service => service.kind === 'library' || service.kind === 'module').length;
    const architectureType = internalUnits.length <= 1
      ? (libraryCount > 0 ? 'modular-monolith' : 'monolith')
      : (workerCount > 0 ? 'event-driven-hybrid' : (appCount > 0 && (serviceCount > 0 || gatewayCount > 0) ? 'hybrid-service-oriented' : 'distributed-monolith'));
    const overallConfidence = coverage?.overallConfidence ?? 0.4;
    const gaps = coverage?.gaps ?? ['Architecture synthesis unavailable'];

    return {
      architectureType,
      score: Math.max(20, Math.min(85, Math.round(overallConfidence * 100))),
      strengths: ['Architecture derived from deterministic inventory and verified unit analyses'],
      weaknesses: gaps.length > 0 ? gaps : ['Architecture synthesis unavailable'],
      globalSummary: `Verified ${internalUnits.length} internal unit(s) and ${services.length - internalUnits.length} infrastructure or integration node(s). Confidence is ${Math.round(overallConfidence * 100)}%, so unresolved gaps are surfaced instead of hidden.`,
    };
  }
}
