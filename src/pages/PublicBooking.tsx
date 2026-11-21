import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { CarPlaceholder, Lightbox } from '../components/photos';
import { Logo, Wordmark } from '../components/ui';
import type { PublicBookingInfo, PublicCategory } from '../domain/booking';
import { validateBookingRequest } from '../domain/booking';
import { dateTime, fromLocalInput, money, num, toLocalInput } from '../domain/format';
import { quote } from '../domain/rules';
import { useData } from '../state/DataContext';

function defaultDates() {
  const s = new Date();
  s.setDate(s.getDate() + 1);
  s.setHours(9, 0, 0, 0);
  const e = new Date(s);
  e.setDate(e.getDate() + 3);
  return { start: s.toISOString(), end: e.toISOString() };
}

const asRate = (c: PublicCategory) => ({ id: '', ...c });

export function PublicBooking({ slug }: { slug: string }) {
  const { store } = useData();
  const [info, setInfo] = useState<PublicBookingInfo | null | undefined>(undefined);
  const [dates, setDates] = useState(defaultDates);
  const [withDriver, setWithDriver] = useState(false);
  const [avail, setAvail] = useState<Record<string, number> | null>(null);
  const [category, setCategory] = useState<string | null>(null);
  const [form, setForm] = useState({ name: '', phone: '', email: '', message: '', companyName: '', companyTaxId: '' });
  const [forCompany, setForCompany] = useState(false);
  const [gallery, setGallery] = useState<{ category: string; photos: string[]; start: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);

  useEffect(() => {
    store.publicBookingInfo(slug).then(setInfo).catch(() => setInfo(null));
  }, [store, slug]);

  const validDates = Date.parse(dates.end) > Date.parse(dates.start);
  useEffect(() => {
    if (!info || !validDates) return setAvail(null);
    let live = true;
    const t = setTimeout(() => {
      store.publicAvailability(slug, dates.start, dates.end).then((a) => live && setAvail(a)).catch(() => live && setAvail(null));
    }, 250);
    return () => {
      live = false;
      clearTimeout(t);
    };
  }, [store, slug, info, dates, validDates]);

  useEffect(() => {
    if (info?.name) document.title = `Réserver un véhicule · ${info.name}`;
  }, [info?.name]);

  const chosen = useMemo(() => info?.categories.find((c) => c.category === category) ?? null, [info, category]);
  const estimate = chosen && validDates ? quote(asRate(chosen), dates.start, dates.end, withDriver) : null;

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    const req = {
      category: category ?? '', start: dates.start, end: dates.end, withDriver,
      name: form.name, phone: form.phone, email: form.email.trim() || null, message: form.message.trim() || null,
      companyName: forCompany ? form.companyName : null,
      companyTaxId: forCompany ? form.companyTaxId.trim() || null : null,
    };
    const err = validateBookingRequest(req, new Date());
    if (err) return setError(err);
    setBusy(true);
    try {
      await store.submitBookingRequest(slug, req);
      setSent(true);
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } catch (ex) {
      setError((ex as Error).message);
    } finally {
      setBusy(false);
    }
  }

  if (info === undefined) return <div className="pub"><p className="muted">Chargement…</p></div>;
  if (info === null) {
    return (
      <div className="pub">
        <div className="card" style={{ maxWidth: 520, margin: '15vh auto' }}>
          <h1 style={{ fontSize: 22 }}>Page introuvable</h1>
          <p className="muted" style={{ margin: 0 }}>Cette page de réservation n’existe pas ou n’est plus ouverte. Contactez directement l’agence.</p>
        </div>
      </div>
    );
  }

  const contact = [info.phone, info.email].filter(Boolean).join(' · ');

  return (
    <div className="pub">
      <header className="pub-head">
        <div className="row" style={{ gap: 14, flexWrap: 'nowrap' }}>
          {info.logo && <img src={info.logo} alt="" style={{ maxHeight: 52, maxWidth: 130, objectFit: 'contain' }} />}
          <div>
            <h1 style={{ margin: 0, fontSize: 24 }}>{info.name}</h1>
            <div className="small muted">{[info.address, info.city].filter(Boolean).join(', ')}{contact && ` · ${contact}`}</div>
          </div>
        </div>
      </header>

      {sent ? (
        <section className="card" style={{ textAlign: 'center', padding: 'var(--space-8)' }} aria-live="polite">
          <div style={{ fontSize: 40 }} aria-hidden="true">✓</div>
          <h2>Demande envoyée</h2>
          <p style={{ margin: '0 auto', maxWidth: 520 }}>
            Merci {form.name.split(' ')[0]}{forCompany && form.companyName ? ` (${form.companyName.trim()})` : ''}. L’agence vérifie la disponibilité et vous recontacte au <strong>{form.phone}</strong> pour confirmer la
            réservation{chosen ? ` (${chosen.category}, du ${dateTime(dates.start)} au ${dateTime(dates.end)})` : ''}. Rien n’est encore payé ni
            confirmé à ce stade.
          </p>
          {info.phone && <p className="small muted">Une question ? Appelez le {info.phone}.</p>}
          <button className="btn" onClick={() => { setSent(false); setCategory(null); }}>Faire une autre demande</button>
        </section>
      ) : (
        <>
          <section className="card" aria-labelledby="quand">
            <h2 id="quand">1. Vos dates</h2>
            <div className="grid-3">
              <label className="field">
                Départ
                <input type="datetime-local" value={toLocalInput(dates.start)} onChange={(e) => e.target.value && setDates({ ...dates, start: fromLocalInput(e.target.value) })} />
              </label>
              <label className="field">
                Retour
                <input type="datetime-local" value={toLocalInput(dates.end)} onChange={(e) => e.target.value && setDates({ ...dates, end: fromLocalInput(e.target.value) })} />
              </label>
              <label className="row" style={{ alignSelf: 'end', minHeight: 44, gap: 8 }}>
                <input type="checkbox" checked={withDriver} onChange={(e) => setWithDriver(e.target.checked)} style={{ width: 18, height: 18 }} />
                Avec chauffeur
              </label>
            </div>
            {!validDates && <p className="error-text" role="alert">La date de retour doit être après la date de départ.</p>}
          </section>

          <section className="card" aria-labelledby="quoi">
            <h2 id="quoi">2. Le véhicule</h2>
            {info.categories.length === 0 ? (
              <p className="muted" style={{ margin: 0 }}>Aucun véhicule proposé en ligne pour le moment. Contactez l’agence{info.phone ? ` au ${info.phone}` : ''}.</p>
            ) : (
              <div className="pub-cats" role="radiogroup" aria-label="Type de véhicule">
                {info.categories.map((c) => {
                  const free = avail ? avail[c.category] ?? 0 : null;
                  const q = validDates ? quote(asRate(c), dates.start, dates.end, withDriver) : null;
                  const full = free === 0;
                  const photos = c.photos ?? [];
                  return (
                    <div key={c.category} className={`pub-cat${category === c.category ? ' selected' : ''}${full ? ' full' : ''}`}>
                      <div className="pub-cat-photo">
                        {photos.length ? (
                          <button type="button" className="pub-cat-photo-btn" onClick={() => setGallery({ category: c.category, photos, start: 0 })} aria-label={`Voir les ${photos.length} photo(s) : ${c.category}`}>
                            <img src={photos[0]} alt={`${c.category} : ${c.models.join(', ')}`} loading="lazy" />
                            {photos.length > 1 && <span className="pub-cat-count">{photos.length} photos</span>}
                          </button>
                        ) : (
                          <CarPlaceholder label={c.category} />
                        )}
                      </div>
                    <button
                      type="button"
                      role="radio"
                      aria-checked={category === c.category}
                      disabled={full}
                      className="pub-cat-body"
                      onClick={() => setCategory(c.category)}
                    >
                      <span className="pub-cat-name">{c.category}</span>
                      <span className="small muted">{c.models.join(', ')}{c.models.length ? ' ou similaire' : ''}</span>
                      <span className="pub-cat-price">{money(c.daily + (withDriver ? c.driverDaily : 0))} <span className="small muted">/ jour</span></span>
                      {q && !full && <span className="small">Total estimé : <strong>{money(q.total)}</strong> pour {q.days} jour{q.days > 1 ? 's' : ''}</span>}
                      <span className={`badge ${full ? 'badge-muted' : free === null ? '' : 'badge-success'}`}>
                        {free === null ? '…' : full ? 'Complet sur ces dates' : category === c.category ? 'Choisi' : 'Disponible · choisir'}
                      </span>
                    </button>
                    </div>
                  );
                })}
              </div>
            )}
          </section>

          {chosen && (
            <section className="card" aria-labelledby="qui">
              <h2 id="qui">3. Vos coordonnées</h2>
              {(chosen.photos?.length ?? 0) > 0 && (
                <div className="photo-strip" aria-label={`Photos : ${chosen.category}`}>
                  {chosen.photos!.map((p, k) => (
                    <button key={p} type="button" onClick={() => setGallery({ category: chosen.category, photos: chosen.photos!, start: k })} aria-label={`Agrandir la photo ${k + 1}`}>
                      <img src={p} alt="" loading="lazy" />
                    </button>
                  ))}
                </div>
              )}
              {estimate && (
                <div className="notice" style={{ margin: 0 }}>
                  <strong>{chosen.category}{withDriver ? ' avec chauffeur' : ''}</strong> · {estimate.days} jour{estimate.days > 1 ? 's' : ''} ·
                  total estimé <strong>{money(estimate.total)}</strong> · caution {money(estimate.caution)} · {num(estimate.kmIncluded)} km inclus,
                  puis {money(chosen.extraKm)} par km. Prix indicatif, confirmé par l’agence.
                </div>
              )}
              <form className="stack" onSubmit={submit} noValidate>
                <label className="row" style={{ gap: 8 }}>
                  <input type="checkbox" checked={forCompany} onChange={(e) => setForCompany(e.target.checked)} style={{ width: 18, height: 18 }} />
                  Je réserve pour une entreprise ou une organisation
                </label>
                {forCompany && (
                  <div className="grid-2">
                    <label className="field">Nom de l’entreprise<input required autoComplete="organization" value={form.companyName} onChange={(e) => setForm({ ...form, companyName: e.target.value })} /></label>
                    <label className="field">NINEA ou identifiant fiscal (facultatif)<input value={form.companyTaxId} onChange={(e) => setForm({ ...form, companyTaxId: e.target.value })} /></label>
                  </div>
                )}
                <div className="grid-2">
                  <label className="field">{forCompany ? 'Votre nom et prénom (personne de contact)' : 'Nom et prénom'}<input required autoComplete="name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></label>
                  <label className="field">Téléphone (WhatsApp de préférence)<input required inputMode="tel" autoComplete="tel" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} /></label>
                  <label className="field">Email (facultatif)<input type="email" autoComplete="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} /></label>
                </div>
                <label className="field">
                  Message (facultatif)
                  <textarea rows={3} maxLength={1000} value={form.message} onChange={(e) => setForm({ ...form, message: e.target.value })} placeholder="Lieu de prise en charge, nombre de passagers, trajet…" />
                </label>
                {error && <p className="error-text" role="alert">{error}</p>}
                <div>
                  <button className="btn btn-primary" disabled={busy || !validDates}>{busy ? 'Envoi…' : 'Envoyer ma demande'}</button>
                </div>
                <p className="hint" style={{ margin: 0 }}>
                  Votre demande n’engage à rien. L’agence vous recontacte pour confirmer. Vos coordonnées servent uniquement à traiter cette demande.
                </p>
              </form>
            </section>
          )}
        </>
      )}

      {gallery && (
        <Lightbox photos={gallery.photos} start={gallery.start} title={gallery.category} onClose={() => setGallery(null)} />
      )}

      <footer className="pub-foot">
        <span className="row" style={{ gap: 6 }}><Logo size={18} inverse={false} /><Wordmark /></span>
        <span>Réservation en ligne propulsée par Yoon Fleet</span>
      </footer>
    </div>
  );
}
