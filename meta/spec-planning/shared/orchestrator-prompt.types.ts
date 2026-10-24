export interface OrchestratorPromptInput {
  repo: string;
  sourceNumber: number;
  tickets: number[];
  baseBranch: string;
  integrationBranch: string;
  marker: string;
}
