"""In-process counters, served as Prometheus text at GET /metrics (internal, token-protected). No dependency."""

from collections import Counter
from threading import Lock


class Metrics:
    def __init__(self) -> None:
        self._counts: Counter[tuple[str, tuple[tuple[str, str], ...]]] = Counter()
        self._lock = Lock()

    def inc(self, name: str, value: float = 1, **labels: str) -> None:
        with self._lock:
            self._counts[(name, tuple(sorted(labels.items())))] += value

    def value(self, name: str, **labels: str) -> float:
        return self._counts[(name, tuple(sorted(labels.items())))]

    def render(self) -> str:
        lines = []
        with self._lock:
            for (name, labels), value in sorted(self._counts.items()):
                label_text = ",".join(f'{k}="{v}"' for k, v in labels)
                lines.append(f"{name}{{{label_text}}} {value:g}" if label_text else f"{name} {value:g}")
        return "\n".join(lines) + "\n"
