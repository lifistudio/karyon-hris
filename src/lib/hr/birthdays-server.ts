import Employee from "@/models/Employee";
import { getSettings } from "@/lib/settings";
import { wibDateKey, timezoneName } from "@/lib/time";
import { birthdayRange, birthdayOccurrences, type BirthdayPerson } from "./birthdays";

export async function getBirthdayDirectory(page = 1, limit = 25) {
  const settings = await getSettings();
  const showBirthYearAndAge = settings.birthday_show_birth_year_age === true;
  const today = wibDateKey();
  const range = birthdayRange(today, { mode: String(settings.birthday_window_mode), months: Number(settings.birthday_months_ahead), before: Number(settings.birthday_days_before), after: Number(settings.birthday_days_after) });
  // PostgreSQL only projects the birth year when the company explicitly enables it.
  const people = await Employee.aggregate<BirthdayPerson>([
    { $match: { status: "active", birthDate: { $type: "date" } } },
    { $project: {
      _id: { $toString: "$_id" },
      name: 1,
      month: { $month: { date: "$birthDate", timezone: timezoneName() } },
      day: { $dayOfMonth: { date: "$birthDate", timezone: timezoneName() } },
      ...(showBirthYearAndAge ? { birthYear: { $year: { date: "$birthDate", timezone: timezoneName() } } } : {}),
    } },
  ]);
  const rows = birthdayOccurrences(people, today, range);
  return { today, ...range, showBirthYearAndAge, total: rows.length, items: rows.slice((page - 1) * limit, page * limit) };
}
