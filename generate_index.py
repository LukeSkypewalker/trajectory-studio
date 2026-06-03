import os
import json

def generate_index():
    trajectories_dir = "Trajectories"
    if not os.path.exists(trajectories_dir):
        print(f"Error: Directory '{trajectories_dir}' not found.")
        return

    all_files = os.listdir(trajectories_dir)
    entries = []
    for f in all_files:
        if f.endswith(".traj"):
            entries.append((f[:-5], "traj"))
        elif f.endswith(".csv"):
            entries.append((f[:-4], "csv"))
            
    entries.sort(key=lambda x: x[0])
    index_data = []
    
    print(f"Indexing {len(entries)} trajectory files...")
    
    for name_hex, file_format in entries:
        traj_path = os.path.join(trajectories_dir, f"{name_hex}.{file_format}")
        repr_path = os.path.join(trajectories_dir, name_hex + ".repr")
        
        status = 0
        has_parts = False
        duration = 0.0
        
        if file_format == "traj":
            # Load traj
            try:
                with open(traj_path, "r") as tf:
                    traj_data = json.load(tf)
                status = traj_data.get("status", 0)
                has_parts = "parts" in traj_data
                if has_parts:
                    parts = traj_data.get("parts", [])
                    if parts:
                        last_part = parts[-1]
                        knots = last_part.get("knots", [])
                        if knots:
                            duration = float(knots[-1])
            except Exception as e:
                print(f"Error loading {traj_path}: {e}")
                continue
        else: # csv
            # Determine length of CSV
            try:
                with open(traj_path, "r") as tf:
                    lines = tf.readlines()
                    num_rows = sum(1 for line in lines if line.strip()) - 1
                status = 70 # Success state for standalone CSVs
                has_parts = True
                duration = max(0.0, num_rows * 0.01) # Default 100Hz frequency
            except Exception as e:
                print(f"Error loading {traj_path}: {e}")
                continue
            
        # Load repr if it exists to get more details
        model_name = "unknown"
        linear_movement = False
        num_parts = 0
        num_box_obstacles = 0
        
        if os.path.exists(repr_path):
            try:
                with open(repr_path, "r") as rf:
                    repr_data = json.load(rf)
                model_name = repr_data.get("equipment_model", {}).get("model_name", "unknown")
                repr_parts = repr_data.get("parts", [])
                num_parts = len(repr_parts)
                linear_movement = any(p.get("linear", False) for p in repr_parts)
                
                # Count box shapes in scene obstacles
                shapes = repr_data.get("scene", {}).get("shapes", [])
                num_box_obstacles = sum(1 for s in shapes if s.get("shape_type") == "box")
            except Exception as e:
                pass
        else:
            if file_format == "csv":
                model_name = "dobot-cr20a" # Default fallback for CSV files
                num_parts = 1
                linear_movement = False
                num_box_obstacles = 0
        
        index_data.append({
            "id": name_hex,
            "status": status,
            "model": model_name,
            "duration": round(duration, 3),
            "num_parts": num_parts,
            "linear": linear_movement,
            "has_path": has_parts,
            "num_box_obstacles": num_box_obstacles,
            "format": file_format
        })
        
    # Sort index_data by number of box obstacles (ascending order)
    index_data.sort(key=lambda x: (x["num_box_obstacles"], x["id"]))
    
    output_path = "trajectories.json"
    with open(output_path, "w") as out:
        json.dump(index_data, out, indent=2)
        
    print(f"Index successfully written to '{output_path}'. Indexed {len(index_data)} trajectories.")

if __name__ == "__main__":
    generate_index()
