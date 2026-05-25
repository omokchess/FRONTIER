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


if __name__ == '__main__':
    unittest.main()
