class Doc2AudioError(Exception):
    """An actionable error safe to display without a Python traceback."""


class GenerationLimitError(Doc2AudioError):
    """The model did not emit an end token; its audio must not be published."""
