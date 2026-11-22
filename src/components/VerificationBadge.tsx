import { verificationLabel, verificationOf } from '../domain/verification';
import { contractSettings } from '../domain/contract';
import type { Client } from '../domain/types';
import { useData } from '../state/DataContext';

/** Pastille « Vérifié / Non vérifié / À revoir » d'un dossier client. */
export function VerificationBadge({ client }: { client: Client }) {
  const { now, session } = useData();
  const rules = contractSettings(session!.org.name, session!.org.contract);
  const v = verificationOf(client, now, rules.minDriverAge);
  const [label, cls] = verificationLabel[v.state];
  return <span className={`badge ${cls}`} title={v.issues.join(' · ') || undefined}>{label}</span>;
}
