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

    def test_sniper_returns_after_three_shots(self):
        s = GameState.initial(parse_hand_str('K0Q0R0B0N0P0SH0SN0JP0'))
        s.king_placed = {'w': True, 'b': True}; s.turn = 'w'
        s.board[7][7] = Piece('w','K'); s.board[0][7] = Piece('b','K')
        s.board[0][0] = Piece('w','SN',2); s.board[0][2] = Piece('b','P')
        self.assertTrue(s.apply(Action('move','w',fr=0,fc=0,tr=0,tc=2)).ok)
        self.assertIsNone(s.board[0][0]); self.assertEqual(s.hands['w']['SN'], 1)

if __name__ == '__main__': unittest.main()
