import unittest
from datetime import date
from schoolmate.calendar_utils import parse_date


class CalendarTests(unittest.TestCase):
    def test_gregorian(self):
        self.assertEqual(parse_date("2026-10-13"), date(2026, 10, 13))

    def test_jalali_current_date_example(self):
        # 1405/07/21 corresponds to 2026-10-13.
        self.assertEqual(parse_date("1405/07/21"), date(2026, 10, 13))

    def test_persian_digits(self):
        self.assertEqual(parse_date("۱۴۰۵/۰۷/۲۱"), date(2026, 10, 13))


if __name__ == "__main__":
    unittest.main()
