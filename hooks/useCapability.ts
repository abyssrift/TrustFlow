import { useAuth } from '@/contexts/AuthContext';
import { useBillingPlan } from './useBillingPlan';
import {
  decideCapabilities,
  type CapabilityDecision,
  type CapabilityName,
} from '@/lib/capabilities';

/** Evaluates a set of capabilities with one auth and one billing hook subscription. */
export function useCapabilities(names: readonly CapabilityName[]): Record<CapabilityName, CapabilityDecision> {
  const { profile, permissionsLoaded, permissions } = useAuth();
  const billing = useBillingPlan();
  return decideCapabilities(names, {
    profile,
    permissionsLoaded,
    permissions,
    billing,
  });
}

/** Convenience wrapper for callers that need one capability. */
export function useCapability(name: CapabilityName): CapabilityDecision {
  return useCapabilities([name])[name];
}
