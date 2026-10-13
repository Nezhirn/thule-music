from app.lyrics.lrc import LrcLine, is_synced, parse_lrc, to_plain

SAMPLE = """[ar:Someone]
[ti:Song]
[offset:+500]
[00:01.00]First line
[00:05.5][00:20.250]Chorus
[00:10.00]<00:10.00>Word <00:10.50>stamps
[00:12.00]
"""


def test_parse_lrc_handles_offsets_multi_stamps_and_word_stamps():
    assert parse_lrc(SAMPLE) == [
        LrcLine(500, "First line"),
        LrcLine(5000, "Chorus"),
        LrcLine(9500, "Word stamps"),
        LrcLine(11500, ""),
        LrcLine(19750, "Chorus"),
    ]


def test_plain_text_is_not_synced():
    assert not is_synced("just words\nmore words")
    assert to_plain("just words\n") == "just words"


def test_to_plain_strips_timestamps():
    assert to_plain("[00:01.00]a\n[00:02.00]b") == "a\nb"
