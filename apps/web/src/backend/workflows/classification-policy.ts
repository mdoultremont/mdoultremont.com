import type { ClassificationDecision } from "@/backend/modules/cc0-classifier"

export function choosePlaylistTargets(input: {
  readonly probabilities: readonly ClassificationDecision[]
  readonly threshold: number
  readonly reviewPlaylistId: string
}): readonly string[] {
  if (
    !Number.isFinite(input.threshold) ||
    input.threshold <= 0 ||
    input.threshold > 1
  )
    throw new Error(
      "A calibrated acceptance threshold between 0 and 1 is required"
    )
  if (!input.reviewPlaylistId) throw new Error("A review playlist is required")
  if (
    input.probabilities.some(
      (decision) =>
        !decision.destinationId ||
        !Number.isFinite(decision.yesProbability) ||
        decision.yesProbability < 0 ||
        decision.yesProbability > 1
    )
  )
    throw new Error("Classifier probabilities are invalid")

  const accepted = input.probabilities
    .filter((decision) => decision.yesProbability >= input.threshold)
    .map((decision) => decision.destinationId)
  return accepted.length > 0 ? [...new Set(accepted)] : [input.reviewPlaylistId]
}
