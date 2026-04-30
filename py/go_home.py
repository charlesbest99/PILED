######################################################
# VERSION 2.0
#  - added flask JSON receive & parsing functionality
######################################################

from flask import Flask, request, jsonify
from flask_cors import CORS
from sense_hat import SenseHat
import time
import threading

# --- 초기 설정 및 전역 변수 ---
sense = SenseHat()
sense.set_rotation(180)

# 기본값 설정
current_raw_sentence = [] # 0과 1로 구성된 매트릭스 리스트
scroll_speed = 0.1
current_padding = 0 # 단어 간 패딩 (0~8)
full_canvas = []
total_w = 0

# 데이터 갱신 플래그 (새 데이터가 오면 True)
data_changed = False
lock = threading.Lock()

app = Flask(__name__)
CORS(app)

# --- 캔버스 재구성 함수 ---
def rebuild_canvas(raw_sentence, padding_size):
    """각 픽셀이 [R, G, B] 리스트인 데이터를 받아 full_canvas 생성"""
    global full_canvas, total_w
    
    black_pixel = [0, 0, 0]
    
    if not raw_sentence:
        full_canvas = [black_pixel] * 64
        total_w = 8
        return

    # 각 행 단위로 단어+패딩을 이어 붙임
    new_canvas = []
    for r in range(8):
        for word in raw_sentence:
            row_pixels = word[r*8 : (r+1)*8]
            new_canvas.extend(row_pixels)
            new_canvas.extend([black_pixel] * padding_size)
            
    full_canvas = new_canvas
    total_w = (8 + padding_size) * len(raw_sentence)

# --- Flask API 경로 ---
@app.route('/update', methods=['POST'])
def update_led():
    global current_raw_sentence, scroll_speed, current_padding, data_changed
    
    data = request.json
    
    try:
        with lock:
            # 1. 문장 업데이트 (각 원소가 [R, G, B] 리스트)
            current_raw_sentence = data.get('sentence', [])
            
            # 2. 스크롤 속도 업데이트
            scroll_speed = data.get('scroll_speed', 0.1)

            # 3. 패딩 값 업데이트 (0~8)
            current_padding = max(0, min(8, data.get('padding', 0))) 
            
            data_changed = True
            
        return jsonify({"status": "success", "message": "LED Data Updated"}), 200
    except Exception as e:
        return jsonify({"status": "error", "message": str(e)}), 400

# --- Flask 실행 함수 ---
def run_flask():
    # 외부 접속 허용을 위해 0.0.0.0으로 실행
    app.run(host='0.0.0.0', port=5000)

# --- 메인 애니메이션 루프 ---
def main():
    global data_changed, full_canvas, total_w, scroll_speed, current_padding
    
    # 초기 캔버스 빌드 (비어있음 방지)
    rebuild_canvas(current_raw_sentence, current_padding)
    
    offset = 0
    try:
        # 서버 시작
        flask_thread = threading.Thread(target=run_flask, daemon=True)
        flask_thread.start()
        
        while True:
            # 데이터 변경 확인 및 반영
            if data_changed:
                with lock:
                    rebuild_canvas(current_raw_sentence, current_padding)
                    offset = 0 # 새 문장이 오면 처음부터 시작
                    data_changed = False
            
            if not full_canvas:
                time.sleep(1)
                continue

            display = []
            for row in range(8):
                row_start = row * total_w
                for col in range(8):
                    pixel_idx = row_start + ((offset + col) % total_w)
                    display.append(full_canvas[pixel_idx])
            
            sense.set_pixels(display)
            offset = (offset + 1) % total_w
            time.sleep(scroll_speed)

    except KeyboardInterrupt:
        sense.clear()

if __name__ == "__main__":
    main()