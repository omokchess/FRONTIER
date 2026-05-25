import unittest

from frontier_ai.az.stats import counts_view, format_move_stats, format_reason_stats, new_result_stats, record_result


class AZStatsTest(unittest.TestCase):
    def test_records_win_and_draw_reasons(self):
        stats = new_result_stats(("w", "b"))

        record_result(stats, "w", "five_in_row", 41)
        record_result(stats, "w", "checkmate", 52)
        record_result(stats, "b", "checkmate", 37)
        record_result(stats, None, "threefold", 88)
        record_result(stats, None, "stalemate", 63)

        self.assertEqual(counts_view(stats, ("w", "b", "draw")), {"w": 2, "b": 1, "draw": 2})
        self.assertEqual(format_reason_stats(stats, ("w", "b", "draw")),
                         "w[five:1,mate:1] b[mate:1] draw[3fold:1,stale:1]")
        self.assertEqual(format_move_stats(stats, ("w", "b", "draw")), "avg=56.2 min=37 max=88")


if __name__ == "__main__":
    unittest.main()
