"""git-filter-repo --commit-callback：统一作者信息并去掉 Co-authored-by 行。"""

AUTHOR_NAME = b"fund-tracker"
AUTHOR_EMAIL = b"fund-tracker@users.noreply.github.com"


def commit_callback(commit, metadata):
    commit.author_name = AUTHOR_NAME
    commit.author_email = AUTHOR_EMAIL
    commit.committer_name = AUTHOR_NAME
    commit.committer_email = AUTHOR_EMAIL
    if commit.message:
        lines = commit.message.split(b"\n")
        lines = [ln for ln in lines if not ln.startswith(b"Co-authored-by:")]
        commit.message = b"\n".join(lines).rstrip() + b"\n"
