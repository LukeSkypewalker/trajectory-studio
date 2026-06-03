import os
import sys
import subprocess
import webbrowser
import http.server
import socketserver
import threading
import time
import json
from pathlib import Path
import scale_traj_time

PORT = 8000
INDEX_FILE = "trajectories.json"

def ensure_index():
    if not os.path.exists(INDEX_FILE):
        print(f"Index '{INDEX_FILE}' not found. Generating it now...")
        import generate_index
        generate_index.generate_index()

class CustomHTTPRequestHandler(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        # Prevent caching for development convenience
        self.send_header('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0')
        self.send_header('Pragma', 'no-cache')
        self.send_header('Expires', '0')
        super().end_headers()

    def do_POST(self):
        if self.path == '/api/scale':
            content_length = int(self.headers.get('Content-Length', 0))
            if content_length == 0:
                self.send_response(400)
                self.end_headers()
                return

            post_data = self.rfile.read(content_length)
            try:
                data = json.loads(post_data.decode('utf-8'))
                traj_id = data.get('id')
                scale = float(data.get('scale', 1.0))

                if not traj_id or scale <= 0:
                    raise ValueError("Invalid id or scale")

                src_path = Path("Trajectories") / f"{traj_id}.traj"
                dest_path = Path("Trajectories") / "export" / f"{traj_id}.traj"

                scale_traj_time.scale_traj_file(src_path, dest_path, scale)

                self.send_response(200)
                self.send_header('Content-Type', 'application/json')
                self.end_headers()
                self.wfile.write(json.dumps({"success": True}).encode('utf-8'))

            except Exception as e:
                self.send_response(500)
                self.send_header('Content-Type', 'application/json')
                self.end_headers()
                self.wfile.write(json.dumps({"error": str(e)}).encode('utf-8'))
        else:
            self.send_response(404)
            self.end_headers()

def start_server():
    # Set workspace directory as root
    os.chdir(os.path.dirname(os.path.abspath(__file__)))
    
    # Enable socket re-use to avoid port-in-use errors on restart
    socketserver.TCPServer.allow_reuse_address = True
    
    with socketserver.TCPServer(("", PORT), CustomHTTPRequestHandler) as httpd:
        print(f"Trajectory Studio running locally at: http://localhost:{PORT}")
        print("Press Ctrl+C in this terminal to stop.")
        try:
            httpd.serve_forever()
        except KeyboardInterrupt:
            print("\nShutting down server...")

def open_browser():
    # Wait a moment for the server to spin up
    time.sleep(1.0)
    webbrowser.open(f"http://localhost:{PORT}")

def watch_trajectories_dir():
    import generate_index
    last_files = set()
    while True:
        try:
            if os.path.exists("Trajectories"):
                # Get both file names and modification times to detect overwrites
                current_files = {}
                for f in os.listdir("Trajectories"):
                    if f.endswith(".csv") or f.endswith(".traj") or f.endswith(".repr"):
                        path = os.path.join("Trajectories", f)
                        current_files[f] = os.path.getmtime(path)
                
                # Check if there is any difference in files list or modification times
                current_files_set = set(current_files.items())
                if current_files_set != last_files:
                    print("Trajectories folder change detected. Re-indexing...")
                    generate_index.generate_index()
                    last_files = current_files_set
        except Exception as e:
            print(f"Error in directory watcher: {e}")
        time.sleep(1.0)

if __name__ == "__main__":
    ensure_index()
    
    # Start trajectories folder watcher in a background thread
    threading.Thread(target=watch_trajectories_dir, daemon=True).start()
    
    # Start browser in a background thread
    threading.Thread(target=open_browser, daemon=True).start()
    
    # Start HTTP server
    start_server()
