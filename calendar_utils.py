"""Date parsing helpers. Accepts Gregorian YYYY-MM-DD and Jalali YYYY/MM/DD or YYYY-MM-DD."""
from datetime import date

_DIGIT_MAP = str.maketrans("۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩", "01234567890123456789")


def jalali_to_gregorian(jy: int, jm: int, jd: int) -> date:
    """Convert a Jalali (Solar Hijri) date to Gregorian using the 33-year cycle."""
    if not (1 <= jm <= 12 and 1 <= jd <= (31 if jm <= 6 else 30)):
        raise ValueError("Invalid Jalali date")
    jy += 1595
    days = -355668 + (365 * jy) + (jy // 33) * 8 + ((jy % 33 + 3) // 4) + jd
    for month_days in (31, 31, 31, 31, 31, 31, 30, 30, 30, 30, 30):
        if jm == 1:
            break
        days += month_days
        jm -= 1
    gy = 400 * (days // 146097)
    days %= 146097
    if days > 36524:
        gy += 100 * ((days - 1) // 36524)
        days = (days - 1) % 36524
        if days >= 365:
            days += 1
    gy += 4 * (days // 1461)
    days %= 1461
    if days > 365:
        gy += (days - 1) // 365
        days = (days - 1) % 365
    gd = days + 1
    leap = gy % 4 == 0 and (gy % 100 != 0 or gy % 400 == 0)
    month_lengths = [31, 29 if leap else 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]
    gm = 1
    for length in month_lengths:
        if gd <= length:
            break
        gd -= length
        gm += 1
    return date(gy, gm, gd)


def parse_date(value: str) -> date:
    value = value.strip().translate(_DIGIT_MAP).replace("/", "-")
    parts = value.split("-")
    if len(parts) != 3 or not all(part.isdigit() for part in parts):
        raise ValueError("Use YYYY-MM-DD or Jalali YYYY/MM/DD")
    year, month, day = map(int, parts)
    if year >= 1300 and year <= 1600:
        return jalali_to_gregorian(year, month, day)
    return date(year, month, day)
