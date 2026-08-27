import random
import unittest

from frontier_ai.game import Action, GameState, parse_hand_str


def brute_force_legal(state: GameState) -> list[Action]:
    """지름길 없는 원본 정의 — 모든 후보를 clone+apply로 검증한다."""
    if state.terminal:
        return []
    out = []
    for action in state.pseudo_actions(state.turn):
        copied = state.clone()
        applied = copied.apply(action, check_terminal=False)
        if applied.ok and applied.reason != "check_suicide":
            out.append(action)
    return out


class LegalFastPathTest(unittest.TestCase):
    """legal_actions()의 배치 지름길이 브루트포스와 같은 집합을 내는지 확인.

    '기물을 더하는 것은 라인을 열 수 없다'는 논리에 기대므로, 체크 중이거나
    체크 금지·5회 한도가 걸린 국면에서는 지름길이 꺼져야 한다. 무작위 대국을
    여러 판 돌려 매 수마다 두 결과를 비교한다.
    """

    def _walk(self, hand, seed, plies=40):
        rng = random.Random(seed)
        s = GameState.initial(parse_hand_str(hand))
        for _ in range(plies):
            fast = sorted(str(a) for a in s.legal_actions())
            slow = sorted(str(a) for a in brute_force_legal(s))
            self.assertEqual(fast, slow, f"seed={seed} history={len(s.history)}")
            legal = s.legal_actions()
            if not legal:
                break
            s.apply(rng.choice(legal))
            if s.terminal:
                break

    def test_matches_brute_force_standard(self):
        for seed in range(6):
            self._walk('K1Q1R2B2N2P8SH0SN0JP0', seed)

    def test_matches_brute_force_with_specials(self):
        for seed in range(6, 10):
            self._walk('K1Q1R2B2N2P8SH1SN1JP1', seed)


if __name__ == '__main__':
    unittest.main()
