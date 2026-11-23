/**
 * The assignment spec defines exactly 4 business collections (users, tuitions, applications, payments).
 * Everything else (quizzes, coins, resources, messages, notifications, tutor requests) is an optional
 * extra and stays OFF unless ENABLE_EXTRA_FEATURES=true.
 */
export function extraFeaturesEnabled(): boolean {
  return process.env.ENABLE_EXTRA_FEATURES?.trim().toLowerCase() === 'true';
}
