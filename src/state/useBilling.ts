import { useMemo } from 'react';
import { billingSettings } from '../domain/billing';
import type { BillingContext } from '../data/services';
import { useData } from './DataContext';

/** Réglages de facturation de l'entreprise et données utiles pour facturer. */
export function useBilling(): BillingContext {
  const { session, data } = useData();
  return useMemo(
    () => ({
      settings: billingSettings(session?.org.name ?? '', session?.org.billing),
      clients: data.clients,
      vehicles: data.vehicles,
      rates: data.rates,
      invoices: data.invoices,
    }),
    [session, data],
  );
}
