"""sync_data_team.py — copy the data team's squat analysis into python/squat/.

The data team works in SportsTechVeloProject/Product-testing. Their files are
copied here unchanged, so it's easy to see whether we're up to date; the
adapter that runs them on recordings from the website is squats.py.

  1. Pull the newest code in your Product-testing clone (branch main).
  2. python sync_data_team.py                       (expects ../../Product-testing)
     python sync_data_team.py C:/path/to/Product-testing
  3. Check that squats.py still matches Squats2.py's steps (git diff shows what
     changed in their files), test, commit.

Writes python/squat/SOURCE.txt with the commit the files came from.
"""

import os
import shutil
import subprocess
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
TARGET = os.path.join(HERE, "squat")
DEFAULT_SOURCE = os.path.join(HERE, "..", "..", "Product-testing")

# Squats2.py is their main script (reads a CSV, plots); it's copied for
# reference only, squats.py follows its steps. The others are imported.
FILES = ["Squats2.py", "MagdwickFilter.py", "VelocityCalculations.py", "ValidatePeaks.py"]


def git(repo, *args):
    return subprocess.run(["git", "-C", repo] + list(args), capture_output=True, text=True, check=True).stdout.strip()


def main():
    repo = os.path.abspath(sys.argv[1] if len(sys.argv) > 1 else DEFAULT_SOURCE)
    folder = os.path.join(repo, "Python", "Squats")
    if not os.path.isdir(folder):
        sys.exit("No Python/Squats in %s. Give the path to your Product-testing clone." % repo)

    branch = git(repo, "branch", "--show-current")
    commit = git(repo, "log", "-1", "--format=%h %ad %an: %s", "--date=short")
    dirty = git(repo, "status", "--porcelain", "--", "Python/Squats")
    if branch != "main":
        print("Note: Product-testing is on branch %s, not main." % branch)
    if dirty:
        print("Note: Python/Squats has uncommitted changes there; copying them as they are:\n" + dirty)

    os.makedirs(TARGET, exist_ok=True)
    for name in FILES:
        shutil.copyfile(os.path.join(folder, name), os.path.join(TARGET, name))
        print("copied", name)

    with open(os.path.join(TARGET, "SOURCE.txt"), "w", encoding="utf-8") as f:
        f.write("Copied unchanged from SportsTechVeloProject/Product-testing, Python/Squats/\n")
        f.write("branch %s, commit %s%s\n" % (branch, commit, " (plus uncommitted changes)" if dirty else ""))
        f.write("Update with python/sync_data_team.py. Don't edit these files here: change them in Product-testing.\n")
    print("\nFrom %s (%s). Now check squats.py against Squats2.py, test, and commit." % (commit, branch))


if __name__ == "__main__":
    main()
