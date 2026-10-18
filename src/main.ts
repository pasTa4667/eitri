import { homedir } from 'node:os';
import { join } from 'node:path';
import { fauxProvider, fauxAssistantMessage } from '@earendil-works/pi-ai/providers/faux';
import { Controller } from './controller.ts';
import { serve } from './http.ts';
import type { Issue } from './domain.ts';

const policy = { project: 'demo', environment: 'demo', repository: 'eitri-test-web-app' };
const issues: Issue[] = ['profile-name', 'cart-total'].map(id => ({
  ...policy, id, title: `Scripted ${id} investigation`, priority: 'high', status: 'unresolved', regressed: false, escalating: false,
}));
const application = await serve(() => Controller.open({
  directory: process.env.EITRI_DATA_DIR ?? join(homedir(), 'Library', 'Application Support', 'eitri'),
  policy,
  providerForCase: () => {
    const faux = fauxProvider();
    faux.setResponses([fauxAssistantMessage('Scripted mode only. Live model, source workspace, validation, and publication are not configured. Operator attention is required.')]);
    return { provider: faux.provider, modelId: faux.getModel().id };
  },
  issues: async () => issues,
}));
const poll = setInterval(() => { void application.controller.poll().catch(() => {}); }, 60_000);
const maintenance = setInterval(() => { void application.controller.maintain().catch(() => {}); }, 60_000);
console.log(`Eitri scripted controller listening on 127.0.0.1:${application.port}. Live integrations are disabled.`);
let closing = false;
for (const signal of ['SIGINT', 'SIGTERM'] as const) process.on(signal, () => {
  if (closing) return;
  closing = true; clearInterval(poll); clearInterval(maintenance);
  void application.close().catch(() => { process.exitCode = 1; });
});
