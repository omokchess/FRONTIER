import unittest

from frontier_ai.az.tactics import tactical_action
from frontier_ai.game import Action, GameState, Piece, parse_hand_str


class AZTacticsTest(unittest.TestCase):
    def test_takes_immediate_five(self):
        s = GameState.initial(parse_hand_str('K0Q0R0B0N0P1SH0SN0JP0'))
        s.king_placed = {'w': True, 'b': True}; s.turn = 'w'
        s.board[7][7] = Piece('w', 'K'); s.board[0][7] = Piece('b', 'K')
        for c in range(1, 5):
            s.board[4][c] = Piece('w', 'P')

        action, reason = tactical_action(s)

        self.assertEqual(reason, 'win')
        self.assertEqual(action, Action('place', 'w', kind='P', r=4, c=5))

    def test_blocks_opponent_immediate_five(self):
        s = GameState.initial(parse_hand_str('K0Q0R0B0N0P1SH0SN0JP0'))
        s.king_placed = {'w': True, 'b': True}; s.turn = 'w'
        s.board[7][7] = Piece('w', 'K'); s.board[0][7] = Piece('b', 'K')
        for c in range(1, 5):
            s.board[4][c] = Piece('b', 'P')

        action, reason = tactical_action(s)

        self.assertEqual(reason, 'block_win')
        self.assertEqual(action, Action('place', 'w', kind='P', r=4, c=5))


    def test_finds_checkmate_win(self):
        """체크메이트로 이기는 수도 찾아야 한다.

        속도를 위해 apply(check_terminal=False)로 바꾸면서 체크메이트 판정을
        '상대가 체크일 때만' 별도로 하도록 재구성했다 — 그 경로가 살아 있는지 확인.
        """
        s = GameState.initial(parse_hand_str('K0Q0R0B0N0P0SH0SN0JP0'))
        s.king_placed = {'w': True, 'b': True}; s.turn = 'w'
        s.board[0][0] = Piece('b', 'K')
        s.board[7][7] = Piece('w', 'K')
        s.board[1][5] = Piece('w', 'R')      # 1행 봉쇄
        s.board[5][7] = Piece('w', 'R')      # 0행으로 내리면 메이트
        s.history = ['x%d' % i for i in range(8)]   # 백 체크 금지 구간 밖

        action, reason = tactical_action(s)

        self.assertEqual(reason, 'win')
        self.assertEqual(action, Action('move', 'w', fr=5, fc=7, tr=0, tc=7))

    def test_no_tactic_returns_none(self):
        s = GameState.initial(parse_hand_str('K0Q0R0B0N0P1SH0SN0JP0'))
        s.king_placed = {'w': True, 'b': True}; s.turn = 'w'
        s.board[7][7] = Piece('w', 'K'); s.board[0][0] = Piece('b', 'K')
        s.history = ['x%d' % i for i in range(8)]

        action, reason = tactical_action(s)

        self.assertIsNone(action)
        self.assertIsNone(reason)


if __name__ == '__main__':
    unittest.main()
