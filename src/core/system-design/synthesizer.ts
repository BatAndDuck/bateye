import { ServiceDesignDoc } from '../../types/index';
import { getRuntime } from '../runtime/factory';
import { systemSynthesisSchema, SystemSynthesis } from '../validation/schemas';
import { buildSystemSynthesisSystemPrompt, buildSystemSynthesisUserMessage } from '../prompts/system-design';

export async function synthesizeArchitecture(
  services: ServiceDesignDoc[],
  repoStructure: string,
  model: string,
  apiKey: string
): Promise<SystemSynthesis> {
  const runtime = await getRuntime();
  const systemPrompt = buildSystemSynthesisSystemPrompt();
  const userMessage = buildSystemSynthesisUserMessage(services, repoStructure);

  try {
    const result = await runtime.run<SystemSynthesis>(
      { systemPrompt, userMessage, model, apiKey, maxTokens: 4096 },
      systemSynthesisSchema
    );
    return result.data;
  } catch {
    // Fallback synthesis
    return {
      architectureType: 'monolith',
      score: 50,
      strengths: ['Code is organized in discoverable modules'],
      weaknesses: ['Architecture synthesis unavailable'],
      globalSummary: `Found ${services.length} services/modules in the codebase.`,
    };
  }
}
