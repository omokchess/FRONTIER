import unittest
from frontier_ai.game import GameState, Piece, Action, parse_hand_str

class EngineTest(unittest.TestCase):
    def test_first_move_must_be_king(self):
        s = GameState.initial()
        self.assertFalse(s.apply(Action('place','w',kind='Q',r=2,c=2)).ok)
        self.assertTrue(s.apply(Action('place','w',kind='K',r=2,c=2)).ok)

    def test_five_in_row_wins(self):
        s = GameState.initial(parse_hand_str('K1Q0R0B0N0P8SH0SN0JP0'))
        s.king_placed = {'w': True, 'b': True}; s.turn = 'w'
        s.board[5][5] = Piece('w','K'); s.board[2][5] = Piece('b','K')
        for c in range(1,5): s.board[4][c] = Piece('w','P')
        res = s.apply(Action('place','w',kind='P',r=4,c=5))
        self.assertEqual(res.winner, 'w'); self.assertEqual(res.reason, 'five_in_row')

    def test_black_can_counter_with_five_while_in_check(self):
        s = GameState.initial(parse_hand_str('K0Q0R0B0N0P1SH0SN0JP0'))
        s.king_placed = {'w': True, 'b': True}; s.turn = 'b'
        s.board[0][0] = Piece('w','K'); s.board[7][5] = Piece('b','K')
        s.board[7][0] = Piece('w','R')
        for c in range(1,5): s.board[4][c] = Piece('b','P')
        self.assertTrue(s.is_in_check('b'))
        res = s.apply(Action('place','b',kind='P',r=4,c=5))
        self.assertTrue(res.ok)
        self.assertEqual(res.winner, 'b'); self.assertEqual(res.reason, 'five_in_row')

    def test_white_must_resolve_check_even_if_five_is_available(self):
        s = GameState.initial(parse_hand_str('K0Q0R0B0N0P1SH0SN0JP0'))
        s.king_placed = {'w': True, 'b': True}; s.turn = 'w'
        s.board[0][5] = Piece('w','K'); s.board[7][7] = Piece('b','K')
        s.board[0][0] = Piece('b','R')
        for c in range(1,5): s.board[4][c] = Piece('w','P')
        self.assertTrue(s.is_in_check('w'))
        res = s.apply(Action('place','w',kind='P',r=4,c=5))
        self.assertFalse(res.ok)
        self.assertIsNone(s.board[4][5])

    def _check_ban_state(self, history_len):
        """백 차례 + 룩 한 수로 흑 킹에 체크를 걸 수 있는 국면."""
        s = GameState.initial(parse_hand_str('K0Q0R0B0N0P0SH0SN0JP0'))
        s.king_placed = {'w': True, 'b': True}; s.turn = 'w'
        s.board[7][7] = Piece('w','K'); s.board[0][4] = Piece('b','K')
        s.board[3][0] = Piece('w','R')
        s.history = ['x%d' % i for i in range(history_len)]
        return s

    def test_white_cannot_check_on_first_two_moves(self):
        for history_len in (0, 2):          # 백의 1수째, 2수째
            s = self._check_ban_state(history_len)
            res = s.apply(Action('move','w',fr=3,fc=0,tr=0,tc=0))
            self.assertFalse(res.ok, 'history=%d' % history_len)
            self.assertIsNotNone(s.board[3][0])     # 수가 되돌려졌는지
            self.assertEqual(s.total_checks['w'], 0)

    def test_white_can_check_from_third_move(self):
        s = self._check_ban_state(4)        # 백의 3수째
        res = s.apply(Action('move','w',fr=3,fc=0,tr=0,tc=0))
        self.assertTrue(res.ok)
        self.assertTrue(res.opponent_in_check)
        self.assertEqual(s.total_checks['w'], 1)

    def test_black_check_is_never_banned(self):
        s = GameState.initial(parse_hand_str('K0Q0R0B0N0P0SH0SN0JP0'))
        s.king_placed = {'w': True, 'b': True}; s.turn = 'b'
        s.board[7][4] = Piece('w','K'); s.board[0][7] = Piece('b','K')
        s.board[3][0] = Piece('b','R')
        s.history = ['x']                   # 흑의 1수째
        res = s.apply(Action('move','b',fr=3,fc=0,tr=7,tc=0))
        self.assertTrue(res.ok)
        self.assertTrue(res.opponent_in_check)

    def test_sniper_returns_after_three_shots(self):
        s = GameState.initial(parse_hand_str('K0Q0R0B0N0P0SH0SN0JP0'))
        s.king_placed = {'w': True, 'b': True}; s.turn = 'w'
        s.board[7][7] = Piece('w','K'); s.board[0][7] = Piece('b','K')
        s.board[0][0] = Piece('w','SN',2); s.board[0][2] = Piece('b','P')
        self.assertTrue(s.apply(Action('move','w',fr=0,fc=0,tr=0,tc=2)).ok)
        self.assertIsNone(s.board[0][0]); self.assertEqual(s.hands['w']['SN'], 1)

if __name__ == '__main__': unittest.main()
