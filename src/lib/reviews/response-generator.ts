/* ─── Template-based AI Response Generator for Reviews ─── */
/* Generates a professional draft response that contractors can edit before sending. */

interface ReviewInput {
  rating: number;
  body: string | null;
  reviewer_name: string;
  trade: string | null;
}

/* ── Trade-specific compliments ── */
const tradeCompliments: Record<string, string[]> = {
  plumbing: [
    "delivering reliable plumbing solutions",
    "keeping your home's plumbing running smoothly",
    "providing top-quality plumbing work",
  ],
  electrical: [
    "ensuring your home's electrical systems are safe and efficient",
    "delivering professional electrical work",
    "providing dependable electrical solutions",
  ],
  roofing: [
    "protecting your home with quality roofing",
    "delivering lasting roofing solutions",
    "providing expert roofing craftsmanship",
  ],
  hvac: [
    "keeping your home comfortable year-round",
    "providing reliable HVAC solutions",
    "ensuring your heating and cooling systems perform at their best",
  ],
  painting: [
    "transforming your space with a fresh look",
    "delivering a beautiful finish",
    "bringing your vision to life with quality painting",
  ],
  general: [
    "delivering quality workmanship",
    "providing reliable service",
    "completing your project to the highest standard",
  ],
};

function getTradeCompliment(trade: string | null): string {
  const key = trade?.toLowerCase() ?? "general";
  const compliments = tradeCompliments[key] ?? tradeCompliments.general;
  return compliments[Math.floor(Math.random() * compliments.length)];
}

function getFirstName(fullName: string): string {
  return fullName.split(" ")[0] || fullName;
}

/* ── Positive response templates (rating 4-5) ── */
function generatePositiveResponse(review: ReviewInput): string {
  const firstName = getFirstName(review.reviewer_name);
  const tradeNote = getTradeCompliment(review.trade);

  if (review.body && review.body.trim().length > 20) {
    // Review has a meaningful body -- reference it
    const templates = [
      `Thank you so much for the kind words, ${firstName}! We take pride in ${tradeNote}, and it means a lot to hear that you had a great experience. We appreciate you taking the time to share your feedback.`,
      `${firstName}, thank you for this wonderful review! Your feedback truly makes our day. We loved ${tradeNote} for you and hope to work together again in the future.`,
      `We're thrilled to hear about your positive experience, ${firstName}! ${tradeNote} is what we do best, and reviews like yours remind us why we love this work. Thank you for your trust.`,
    ];
    return templates[Math.floor(Math.random() * templates.length)];
  }

  // Rating-only review (no body or short body)
  const templates = [
    `Thank you for the ${review.rating}-star rating, ${firstName}! We're glad we could deliver quality results. If you ever need anything in the future, don't hesitate to reach out.`,
    `${firstName}, we appreciate the great rating! It was a pleasure working with you. We look forward to helping you again down the road.`,
    `Thanks for the stellar review, ${firstName}! We're committed to ${tradeNote}, and we're glad it showed. Feel free to reach out anytime.`,
  ];
  return templates[Math.floor(Math.random() * templates.length)];
}

/* ── Neutral response templates (rating 3) ── */
function generateNeutralResponse(review: ReviewInput): string {
  const firstName = getFirstName(review.reviewer_name);

  if (review.body && review.body.trim().length > 20) {
    const templates = [
      `Thank you for your honest feedback, ${firstName}. We appreciate you sharing your experience and take your comments seriously. We'd love the opportunity to discuss how we can improve. Please don't hesitate to reach out to us directly.`,
      `${firstName}, thank you for taking the time to leave a review. We value your feedback and are always looking for ways to improve our service. If there's anything we can do to earn a higher rating next time, please let us know.`,
    ];
    return templates[Math.floor(Math.random() * templates.length)];
  }

  const templates = [
    `Thank you for your review, ${firstName}. We appreciate your feedback and are always striving to improve. If there's anything we could have done better, we'd love to hear from you directly so we can make it right.`,
    `${firstName}, thanks for taking the time to rate your experience. We aim for every project to exceed expectations. Please reach out if there's anything we can do to improve your experience.`,
  ];
  return templates[Math.floor(Math.random() * templates.length)];
}

/* ── Negative response templates (rating 1-2) ── */
function generateNegativeResponse(review: ReviewInput): string {
  const firstName = getFirstName(review.reviewer_name);

  if (review.body && review.body.trim().length > 20) {
    const templates = [
      `${firstName}, we're sorry to hear about your experience. This is not the level of service we strive to provide. We take your feedback very seriously and would like the opportunity to make things right. Please contact us directly so we can address your concerns.`,
      `Thank you for your candid feedback, ${firstName}. We sincerely apologize that we didn't meet your expectations. Your satisfaction matters to us, and we'd like to work with you to resolve any outstanding issues. Please reach out to us at your earliest convenience.`,
    ];
    return templates[Math.floor(Math.random() * templates.length)];
  }

  const templates = [
    `${firstName}, we're disappointed to hear that your experience didn't meet expectations. We'd appreciate the chance to learn more about what went wrong and make it right. Please don't hesitate to contact us directly.`,
    `Thank you for your review, ${firstName}. We're sorry we fell short. Every customer's experience matters to us, and we'd like the opportunity to address your concerns. Please reach out so we can discuss how to improve.`,
  ];
  return templates[Math.floor(Math.random() * templates.length)];
}

/* ── Main export ── */
export function generateResponseDraft(review: ReviewInput): string {
  if (review.rating >= 4) return generatePositiveResponse(review);
  if (review.rating === 3) return generateNeutralResponse(review);
  return generateNegativeResponse(review);
}
