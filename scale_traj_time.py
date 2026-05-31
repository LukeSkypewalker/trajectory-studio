import argparse
import json
import shutil
from pathlib import Path
from typing import List

import numpy as np


def _scale_time_axis(part: dict, scale: float) -> None:
    # Some files may use "nodes" instead of "knots".
    time_key = "knots" if "knots" in part else "nodes" if "nodes" in part else None
    if time_key is None:
        return

    times = np.asarray(part[time_key], dtype=float)
    if times.ndim != 1:
        raise ValueError(f'Field "{time_key}" must be a 1D array.')
    if times.size < 2:
        raise ValueError(f'Field "{time_key}" must contain at least 2 values.')
    if np.any(np.diff(times) <= 0):
        raise ValueError(f'Field "{time_key}" must be strictly increasing.')

    part[time_key] = (times * scale).tolist()

    if "coeffs" not in part:
        return

    coeffs = np.asarray(part["coeffs"], dtype=float)
    if coeffs.ndim != 3 or coeffs.shape[1] != 4:
        raise ValueError('Field "coeffs" must have shape [dof, 4, segments].')
    segments = times.size - 1
    if coeffs.shape[2] != segments:
        raise ValueError(
            f'Field "coeffs" has {coeffs.shape[2]} segments, expected {segments}.'
        )

    # Cubic local polynomial: x(t) = a*dt^3 + b*dt^2 + c*dt + d.
    # Time scaling tau = scale * t gives dt = d_tau / scale.
    # So [a, b, c, d] -> [a/scale^3, b/scale^2, c/scale, d].
    divisors = np.array([scale**3, scale**2, scale, 1.0], dtype=float).reshape(1, 4, 1)
    part["coeffs"] = (coeffs / divisors).tolist()


def scale_traj_file(src_path: Path, dest_path: Path, scale: float) -> None:
    if not src_path.exists():
        raise FileNotFoundError(f"File not found: {src_path}")

    with src_path.open("r", encoding="utf-8") as f:
        data = json.load(f)

    parts = data.get("parts")
    if not isinstance(parts, list):
        raise ValueError('Expected top-level field "parts" as a list.')

    for i, part in enumerate(parts):
        if not isinstance(part, dict):
            raise ValueError(f"parts[{i}] must be an object.")
        _scale_time_axis(part, scale)

    # Ensure destination directory exists
    dest_path.parent.mkdir(parents=True, exist_ok=True)
    
    backup_path = Path(str(dest_path) + ".original")
    shutil.copy2(src_path, backup_path)

    with dest_path.open("w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)
        f.write("\n")


def _collect_traj_files(paths: List[str]) -> List[Path]:
    files: List[Path] = []
    for raw_path in paths:
        path = Path(raw_path)
        if not path.exists():
            raise FileNotFoundError(f"Path not found: {path}")

        if path.is_dir():
            files.extend(sorted(path.glob("*.traj")))
            continue

        if path.is_file():
            files.append(path)
            continue

        raise ValueError(f"Unsupported path type: {path}")

    # Keep deterministic order and avoid duplicate processing.
    return sorted(set(files), key=lambda p: str(p.resolve()))


def main() -> None:
    parser = argparse.ArgumentParser(
        description=(
            "Scale trajectory spline time. "
            "First arg is scale, following args are files and/or directories."
        )
    )
    parser.add_argument("scale", type=float, help="Time scale factor (>0).")
    parser.add_argument(
        "paths",
        nargs="+",
        help="One or more file/dir paths. For dir path, all *.traj files are processed.",
    )
    args = parser.parse_args()

    if args.scale <= 0:
        raise ValueError("Scale factor must be > 0.")

    files = _collect_traj_files(args.paths)
    if not files:
        raise ValueError("No .traj files found to process.")

    for file_path in files:
        scale_traj_file(file_path, file_path, args.scale)


if __name__ == "__main__":
    main()
