import { describe, expect, test } from "vitest"
import { choosePlaylistTargets } from "./classification-policy"

describe("classification playlist policy", () => {
  test("accepts every independently supported destination", () => {
    expect(
      choosePlaylistTargets({
        probabilities: [
          { destinationId: "electronic", yesProbability: 0.94 },
          { destinationId: "night", yesProbability: 0.88 },
          { destinationId: "jazz", yesProbability: 0.22 },
        ],
        threshold: 0.8,
        reviewPlaylistId: "review",
      })
    ).toEqual(["electronic", "night"])
  })

  test("routes zero accepted destinations to the review playlist", () => {
    expect(
      choosePlaylistTargets({
        probabilities: [{ destinationId: "jazz", yesProbability: 0.55 }],
        threshold: 0.8,
        reviewPlaylistId: "review",
      })
    ).toEqual(["review"])
  })

  test("refuses invalid probabilities and thresholds", () => {
    expect(() =>
      choosePlaylistTargets({
        probabilities: [{ destinationId: "jazz", yesProbability: Number.NaN }],
        threshold: 0.8,
        reviewPlaylistId: "review",
      })
    ).toThrow("Classifier probabilities are invalid")
  })
})
