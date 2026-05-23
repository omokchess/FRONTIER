import unittest
from frontier_ai.game import GameState, Piece, Action, parse_hand_str
from frontier_ai.model import ValueModel, make_seed_model
from frontier_ai.search import choose_action

class SearchTest(unittest.TestCase):
    def test_takes_immediate_five(self):
        s = GameState.initial(parse_hand_str('K0Q0R0B0N0P2SH0SN0JP0'))
        s.king_placed = {'w': True, 'b': True}; s.turn = 'w'
        s.board[5][5] = Piece('w','K'); s.board[2][5] = Piece('b','K')
        for c in range(1,5): s.board[4][c] = Piece('w','P')
        a, info = choose_action(s, ValueModel(make_seed_model()), 4, 1)
        self.assertEqual((a.type, a.r, a.c), ('place',4,5)); self.assertEqual(info.get('forced'), 'win')
if __name__ == '__main__': unittest.main()
