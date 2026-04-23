export interface CheckoutSessionParams {
  priceId: string;
  customerId: string;
  successUrl: string;
  cancelUrl: string;
}

export interface BillingPortalParams {
  customerId: string;
  returnUrl: string;
}

export interface SubscriptionTier {
  id: string;
  name: string;
  priceId: string;
  monthlyPrice: number;
  features: string[];
}
