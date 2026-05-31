import os
import sys
import subprocess
import webbrowser
import http.server
import socketserver
import threading
import time

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

if __name__ == "__main__":
    ensure_index()
    
    # Start browser in a background thread
    threading.Thread(target=open_browser, daemon=True).start()
    
    # Start HTTP server
    start_server()
