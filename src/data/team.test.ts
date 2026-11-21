import { describe, expect, it } from 'vitest';
import { DemoStore } from './demoStore';

function memory() {
  const m = new Map<string, string>();
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), removeItem: (k: string) => void m.delete(k) };
}

describe('équipe (mode démo)', () => {
  it('invite, refuse les doublons et les adresses invalides, puis annule', async () => {
    const s = new DemoStore(memory());
    await s.signIn('dg@sdt.sn', 'admin');
    const inv = await s.invite('  Nouvel.Agent@SDT.sn ', 'agent');
    expect(inv.email).toBe('nouvel.agent@sdt.sn');
    await expect(s.invite('nouvel.agent@sdt.sn', 'comptable')).rejects.toThrow(/déjà en attente/);
    await expect(s.invite('awa.agent@sdt.sn', 'agent')).rejects.toThrow(/déjà partie/);
    await expect(s.invite('pas-un-email', 'agent')).rejects.toThrow(/invalide/);
    await s.cancelInvitation(inv.id);
    expect(await s.listInvitations()).toHaveLength(0);
  });

  it("garde toujours un administrateur et n'autorise pas à se retirer soi-même", async () => {
    const s = new DemoStore(memory());
    await s.signIn('dg@sdt.sn', 'admin');
    const me = (await s.session())!.userId;
    await expect(s.updateMemberRole(me, 'direction')).rejects.toThrow(/au moins un administrateur/);
    await expect(s.removeMember(me)).rejects.toThrow(/vous-même/);
    await s.updateMemberRole('u-agent', 'admin');
    await s.updateMemberRole(me, 'direction');
    expect((await s.session())!.role).toBe('direction');
  });

  it("l'invité rejoint l'équipe avec le profil de l'invitation", async () => {
    const s = new DemoStore(memory());
    await s.signIn('dg@sdt.sn', 'admin');
    await s.invite('compta2@sdt.sn', 'comptable');
    await s.signOut();
    await s.signUp('compta2@sdt.sn', 'motdepasse', '', '');
    const sess = await s.session();
    expect(sess?.role).toBe('comptable');
    expect(sess?.org.name).toBe('Sénégal Découverte Touristique');
  });
});
