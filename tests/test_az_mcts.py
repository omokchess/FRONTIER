import unittest

from frontier_ai.game import Action, GameState

try:
    from frontier_ai.az.encoding import action_to_index
    from frontier_ai.az.mcts import Node, choose, non_threefold_indices, visit_policy
except ModuleNotFoundError as exc:
    if exc.name != "numpy":
        raise
    raise unittest.SkipTest("numpy is not installed")


class AZMCTSTest(unittest.TestCase):
    def test_can_mask_immediate_threefold_draw(self):
        state = GameState.initial()
        repeat_action = Action("place", "w", kind="K", r=2, c=2)
        safe_action = Action("place", "w", kind="K", r=2, c=3)

        repeated = state.clone()
        repeated.apply(repeat_action, check_terminal=False)
        state.history = [repeated.position_key(), repeated.position_key()]

        repeat_idx = action_to_index(repeat_action)
        safe_idx = action_to_index(safe_action)
        root = Node(state)
        root.N = {repeat_idx: 10, safe_idx: 1}
        root.W = {repeat_idx: 0.0, safe_idx: 0.0}

        allowed, avoided = non_threefold_indices(root)

        self.assertEqual(avoided, 1)
        self.assertNotIn(repeat_idx, allowed)
        self.assertIn(safe_idx, allowed)
        self.assertEqual(choose(root, temperature=1e-9, allowed=allowed), safe_idx)
        self.assertAlmostEqual(float(visit_policy(root, allowed=allowed).sum()), 1.0)
        self.assertEqual(float(visit_policy(root, allowed=allowed)[repeat_idx]), 0.0)


if __name__ == "__main__":
    unittest.main()
