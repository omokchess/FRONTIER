import unittest

from frontier_ai.az.stats import (
    counts_view,
    format_group_counts,
    format_move_stats,
    format_reason_stats,
    new_result_stats,
    record_result,
)


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

    def test_formats_group_counts(self):
        white = new_result_stats(("candidate", "best"))
        black = new_result_stats(("candidate", "best"))
        record_result(white, "candidate", "checkmate", 42)
        record_result(black, None, "threefold", 91)

        self.assertEqual(
            format_group_counts(
                {"candidate_white": white, "candidate_black": black},
                (("candidate_white", "candW"), ("candidate_black", "candB")),
                ("candidate", "best", "draw"),
            ),
            "candW={'candidate': 1, 'best': 0, 'draw': 0} candB={'candidate': 0, 'best': 0, 'draw': 1}",
        )


if __name__ == "__main__":
    unittest.main()
