import { useState, type FormEvent } from 'react';
import { billingSettings, payeeLines, termsFor, type BillingSettings, type Payees } from '../domain/billing';
import { useData } from '../state/DataContext';
import { ErrorBox } from './ui';

export function BillingSettingsForm({ editable }: { editable: boolean }) {
  const { session, store, setSession, toast } = useData();
  const org = session!.org;
  const [s, setS] = useState<BillingSettings>(() => billingSettings(org.name, org.billing));
  const [error, setError] = useState<string | null>(null);
  const setP = (k: keyof Payees) => (e: { target: { value: string } }) => setS({ ...s, payees: { ...s.payees, [k]: e.target.value } });
  const n = (v: string, lo: number, hi: number) => Math.min(hi, Math.max(lo, Math.round(Number(v) || 0)));

  async function save(e: FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      await store.updateOrganization({ billing: s });
      setSession(await store.session());
      toast('Modalités de paiement enregistrées');
    } catch (err) {
      setError((err as Error).message);
    }
  }

  return (
    <section className="card" aria-labelledby="facturation">
      <h2 id="facturation">Facturation et paiements</h2>
      <p className="small muted" style={{ margin: 0 }}>
        Une facture est établie dès qu’une réservation est validée, avec ces modalités. Vos clients vous paient directement, avec vos propres moyens ; l’agent
        enregistre ensuite le paiement et sa référence.
      </p>
      <form className="stack" onSubmit={save}>
        <fieldset disabled={!editable} className="stack" style={{ border: 0, padding: 0, margin: 0 }}>
          <fieldset className="form-group stack">
            <legend>Modalités par défaut</legend>
            <div className="grid-2">
              <label className="field">
                Acompte à la réservation (%)
                <input type="number" min={0} max={100} value={s.depositPercent} onChange={(e) => setS({ ...s, depositPercent: n(e.target.value, 0, 100) })} />
              </label>
              <label className="field">
                Solde d’un particulier
                <select value={s.balanceWhen} onChange={(e) => setS({ ...s, balanceWhen: e.target.value as BillingSettings['balanceWhen'] })}>
                  <option value="depart">À la remise des clés</option>
                  <option value="retour">Au retour du véhicule</option>
                </select>
              </label>
              <label className="field">
                Délai de paiement des entreprises (jours)
                <input type="number" min={0} max={180} value={s.companyDueDays} onChange={(e) => setS({ ...s, companyDueDays: n(e.target.value, 0, 180) })} />
                <span className="hint">0 = mêmes règles que les particuliers. Modifiable client par client.</span>
              </label>
            </div>
            <p className="small" style={{ margin: 0 }}>
              Particulier : <strong>{termsFor(s, { kind: 'particulier' }).label}</strong>
              <br />
              Entreprise : <strong>{termsFor(s, { kind: 'entreprise' }).label}</strong>
            </p>
          </fieldset>

          <fieldset className="form-group stack">
            <legend>TVA</legend>
            <label className="row" style={{ gap: 8 }}>
              <input type="checkbox" checked={s.vatEnabled} onChange={(e) => setS({ ...s, vatEnabled: e.target.checked })} style={{ width: 18, height: 18 }} />
              Mon entreprise est assujettie à la TVA
            </label>
            {s.vatEnabled && (
              <label className="field" style={{ maxWidth: 220 }}>
                Taux (%)
                <input type="number" min={0} max={100} step={0.5} value={s.vatRate} onChange={(e) => setS({ ...s, vatRate: Math.min(100, Math.max(0, Number(e.target.value) || 0)) })} />
              </label>
            )}
            <span className="hint">
              Vos tarifs sont saisis hors taxes ; la TVA s’ajoute sur la facture. Faites confirmer votre régime et votre taux par votre comptable.
            </span>
          </fieldset>

          <fieldset className="form-group stack">
            <legend>Vos moyens d’encaissement</legend>
            <span className="hint">Affichés sur les factures, les contrats et le message WhatsApp envoyé au client. Laissez vide ce que vous n’utilisez pas.</span>
            <div className="grid-2">
              <label className="field">Numéro Wave<input inputMode="tel" value={s.payees.wave} onChange={setP('wave')} /></label>
              <label className="field">Numéro Orange Money<input inputMode="tel" value={s.payees.orangeMoney} onChange={setP('orangeMoney')} /></label>
              <label className="field">Numéro Free Money<input inputMode="tel" value={s.payees.freeMoney} onChange={setP('freeMoney')} /></label>
              <label className="field">Numéro MTN MoMo<input inputMode="tel" value={s.payees.mtn} onChange={setP('mtn')} /></label>
              <label className="field">Numéro Moov Money<input inputMode="tel" value={s.payees.moov} onChange={setP('moov')} /></label>
              <label className="field">Banque<input value={s.payees.bankName} onChange={setP('bankName')} placeholder="CBAO, Ecobank…" /></label>
              <label className="field">RIB ou IBAN<input value={s.payees.iban} onChange={setP('iban')} /></label>
              <label className="field">Chèques à l’ordre de<input value={s.payees.chequeOrder} onChange={setP('chequeOrder')} /></label>
            </div>
            {payeeLines(s.payees).length > 0 && <p className="small muted" style={{ margin: 0 }}>Aperçu : {payeeLines(s.payees).join(' · ')}</p>}
          </fieldset>

          <label className="field">
            Mention en bas de facture (facultatif)
            <input value={s.invoiceFooter} maxLength={300} onChange={(e) => setS({ ...s, invoiceFooter: e.target.value })} placeholder="Capital, mentions légales, pénalités de retard…" />
          </label>
        </fieldset>
        <ErrorBox error={error} />
        {editable ? <button className="btn btn-dark" style={{ alignSelf: 'flex-start' }}>Enregistrer</button> : <span className="hint">Seul un administrateur peut modifier ces réglages.</span>}
      </form>
    </section>
  );
}
