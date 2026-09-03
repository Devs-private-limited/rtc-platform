import { getAppPlan } from "./apps.js";
import {
  BILLING_PLANS,
  FEATURE_NAMES,
  getPlanFeatures,
  type BillingPlan,
  type PlanFeature,
  type PlanFeatures,
} from "./billing-plans.js";

export type FeatureCheckResult =
  | { allowed: true; plan: BillingPlan; features: PlanFeatures }
  | { allowed: false; plan: BillingPlan; feature: PlanFeature; message: string };

export async function checkAppFeature(
  appId: string,
  feature: PlanFeature
): Promise<FeatureCheckResult> {
  const plan = await getAppPlan(appId);
  const features = getPlanFeatures(plan);
  if (features[feature]) {
    return { allowed: true, plan, features };
  }
  const planName = BILLING_PLANS[plan].name;
  return {
    allowed: false,
    plan,
    feature,
    message: `${FEATURE_NAMES[feature]} is not included in the ${planName} plan. Upgrade your plan to use this feature.`,
  };
}

export { getPlanFeatures };
