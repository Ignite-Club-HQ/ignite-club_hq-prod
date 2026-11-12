import { describe, expect, it } from 'vitest';
import { createFutureEngineDraft, prepareEngineHandover } from './engineSwitchPreparation';
import { DEFAULT_BACKEND_ROUTING_CONFIG, isCloudEngineUsable, normalizeApprovedTarget, parseBackendRoutingConfig, resolveIcpEngineForCountry } from './backendRouting';

describe('deferred Cloud Engine switch', () => {
  it('prepares a disabled draft without engine connection details', () => {
    const draft = createFutureEngineDraft([]);
    expect(draft.enabled).toBe(false);
    expect(draft.host).toBeUndefined();
    expect(draft.canisterIds).toBeUndefined();
    expect(isCloudEngineUsable(draft)).toBe(false);
  });
  it('retains mainnet and country pins when saving a future draft', () => {
    const mainnet = normalizeApprovedTarget({ backend: 'icp', kind: 'icp-mainnet', alias: 'mainnet', version: 'v1', enabled: true });
    const existing = { ...DEFAULT_BACKEND_ROUTING_CONFIG, defaultBackend: 'icp' as const, targets: [mainnet], countryRules: { AU: 'icp' as const }, countryTargets: { AU: mainnet.id } };
    const before = JSON.stringify(existing);
    const config = parseBackendRoutingConfig({ ...existing, targets: [...existing.targets, createFutureEngineDraft(existing.targets)] });
    expect(JSON.stringify(existing)).toBe(before);
    expect(config?.defaultBackend).toBe('icp');
    expect(config?.countryTargets).toEqual({ AU: mainnet.id });
    expect(config?.countryRules).toEqual({ AU: 'icp' });
    expect(config && resolveIcpEngineForCountry(config, 'AU')).toBeNull();
    expect(config?.targets[0]).toEqual(mainnet);
  });
  it('does not replace another draft', () => {
    expect(createFutureEngineDraft([createFutureEngineDraft([])]).id).toBe('icp/future-engine-2/v1');
  });
  it('exports disabled preparation without activation or relocation authority', () => {
    const original = { ...createFutureEngineDraft([]), enabled: true };
    const bundle = prepareEngineHandover(original);
    expect(bundle.target.enabled).toBe(false);
    expect(original.enabled).toBe(true);
    expect(bundle.activationAuthorized).toBe(false);
    expect(bundle.existingClubPolicy).toBe('retain-original-deployment');
    expect(bundle.encryptedMediaPolicy).toBe('do-not-move-existing-encrypted-clubs');
    expect(bundle).not.toHaveProperty('countryTargets');
    expect(bundle.requiredServices).toContain('media_blob_store');
  });
  it('refuses a mainnet target as an engine handover', () => {
    const mainnet = normalizeApprovedTarget({ backend: 'icp', kind: 'icp-mainnet', alias: 'mainnet', version: 'v1', enabled: true });
    expect(() => prepareEngineHandover(mainnet)).toThrow('Select a Cloud Engine draft.');
  });
  it('keeps opening behind calls, encryption, isolated acceptance, operations and owner review', () => {
    const bundle = prepareEngineHandover(createFutureEngineDraft([]));
    const stages = bundle.checklist;
    expect(stages.find(s => s.id === 'isolated-club')?.requires).toEqual(['calls', 'encryption']);
    expect(stages.find(s => s.id === 'owner-review')?.requires).toEqual(['operations']);
    expect(stages.find(s => s.id === 'new-clubs')?.requires).toEqual(['owner-review']);
    expect(stages.filter(s => !s.requiresEngine).map(s => s.id)).toEqual(['economics']);
    expect(stages.every(s => s.status === 'pending')).toBe(true);
    expect(bundle.checklistAuthorizesActivation).toBe(false);
    expect(bundle.activationAuthorized).toBe(false);
    const visited = new Set<string>();
    for (const stage of stages) {
      expect(stage.requires.every(id => visited.has(id))).toBe(true);
      visited.add(stage.id);
    }
  });
});