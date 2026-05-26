import unittest

from frontier_ai.az.outcomes import outcome_values


class AZOutcomesTest(unittest.TestCase):
    def test_wins_keep_full_value_targets(self):
        self.assertEqual(outcome_values("w", "five_in_row", "w", 0.2), {"w": 1.0, "b": -1.0})
        self.assertEqual(outcome_values("b", "checkmate", "w", 0.2), {"w": -1.0, "b": 1.0})

    def test_threefold_contempt_penalizes_final_mover(self):
        self.assertEqual(outcome_values(None, "threefold", "w", 0.2), {"w": -0.2, "b": 0.2})
        self.assertEqual(outcome_values(None, "threefold", "b", 0.2), {"w": 0.2, "b": -0.2})

    def test_other_draws_remain_neutral(self):
        self.assertEqual(outcome_values(None, "stalemate", "w", 0.2), {"w": 0.0, "b": 0.0})
        self.assertEqual(outcome_values(None, "max_moves", "b", 0.2), {"w": 0.0, "b": 0.0})


if __name__ == "__main__":
    unittest.main()
