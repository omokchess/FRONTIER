import json, os, sys
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', '..'))
from frontier_ai.game import GameState, Piece, parse_hand_str

EMPTY = 'K0Q0R0B0N0P0SH0SN0JP0'
def mk(hand=EMPTY, turn='w', hist=8):
    s = GameState.initial(parse_hand_str(hand))
    s.king_placed = {'w':True,'b':True}; s.turn = turn
    s.history = ['x%d'%i for i in range(hist)]
    return s

cases = []
def add(name, s):
    legal = s.legal_actions()
    keys = set()
    for a in legal:
        if a.type == 'place': keys.add(f"P|{a.kind}|{a.r}|{a.c}")
        else:                 keys.add(f"M|{a.fr}|{a.fc}|{a.tr}|{a.tc}")   # 프로모션 변형은 합침
    st = s.to_json(); st['history'] = s.history
    cases.append({"name":name, "state":st, "legal":sorted(keys)})

# 1) 방패가 아군을 앞에 둔 경우 (아군 밀기 금지)
s = mk(); s.board[0][0]=Piece('w','K'); s.board[7][7]=Piece('b','K')
s.board[4][4]=Piece('w','SH'); s.board[3][4]=Piece('w','P')
add('방패-아군앞', s)

# 2) 방패가 적을 앞에 둔 경우 (밀기 가능)
s = mk(); s.board[0][0]=Piece('w','K'); s.board[7][7]=Piece('b','K')
s.board[4][4]=Piece('w','SH'); s.board[3][4]=Piece('b','P')
add('방패-적앞', s)

# 3) 스나이퍼 사격
s = mk(); s.board[0][7]=Piece('w','K'); s.board[7][0]=Piece('b','K')
s.board[0][0]=Piece('w','SN'); s.board[0][3]=Piece('b','P'); s.board[3][0]=Piece('b','R')
add('스나이퍼', s)

# 4) 흑 캡처 금지 구간
s = mk(turn='b', hist=3); s.board[0][0]=Piece('b','K'); s.board[7][7]=Piece('w','K')
s.board[3][0]=Piece('b','R'); s.board[3][4]=Piece('w','P')
add('흑-캡처금지', s)

# 5) 흑 캡처 허용 구간
s = mk(turn='b', hist=9); s.board[0][0]=Piece('b','K'); s.board[7][7]=Piece('w','K')
s.board[3][0]=Piece('b','R'); s.board[3][4]=Piece('w','P')
add('흑-캡처허용', s)

# 6) 백 체크 금지 구간
s = mk(turn='w', hist=0); s.board[7][7]=Piece('w','K'); s.board[0][4]=Piece('b','K')
s.board[3][0]=Piece('w','R')
add('백-체크금지', s)

# 7) 폰 프로모션 직전
s = mk(hand='K0Q0R0B0N0P1SH0SN0JP0'); s.board[7][7]=Piece('w','K'); s.board[0][7]=Piece('b','K')
s.board[1][2]=Piece('w','P')
add('폰-프로모션', s)

# 8) 손패 배치 (일반 + 스나이퍼 코너)
s = mk(hand='K0Q1R1B0N0P0SH0SN1JP0'); s.board[7][7]=Piece('w','K'); s.board[0][7]=Piece('b','K')
add('배치', s)

# 9) 핀 걸린 기물
s = mk(); s.board[0][0]=Piece('w','K'); s.board[0][1]=Piece('w','Q')
s.board[0][5]=Piece('b','R'); s.board[7][7]=Piece('b','K')
add('핀', s)

# 10) 어쌔신 점프
s = mk(); s.board[0][0]=Piece('w','K'); s.board[7][7]=Piece('b','K')
s.board[4][4]=Piece('w','JP'); s.board[4][6]=Piece('b','P'); s.board[2][4]=Piece('w','P')
add('어쌔신', s)

open(os.path.join(os.path.dirname(__file__), '..', '..', '_parity.json'),'w',encoding='utf-8').write(json.dumps(cases,ensure_ascii=False))
print(f"{len(cases)}개 국면 생성")
for c in cases: print(f"  {c['name']}: {len(c['legal'])}개")
