export interface HandoffCliOptions {
  step?: string;
  expected?: string;
  session?: string;
  project?: string;
  thread?: string;
  'client-thread'?: string;
  host?: string;
  manual?: boolean;
  'confirm-stopped'?: boolean;
  'confirmed-absent'?: boolean;
}
