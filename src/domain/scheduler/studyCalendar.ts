export type StudyCalendar = {
  startOfStudyDay(timestamp: number): number;
  addStudyDays(timestamp: number, days: number): number;
  dateKey(timestamp: number): string;
};

function assertFiniteTimestamp(timestamp: number): void {
  if (!Number.isFinite(timestamp)) throw new RangeError("Timestamp must be finite");
}

export function createLocalStudyCalendar(): StudyCalendar {
  return {
    startOfStudyDay(timestamp) {
      assertFiniteTimestamp(timestamp);
      const date = new Date(timestamp);
      return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
    },
    addStudyDays(timestamp, days) {
      assertFiniteTimestamp(timestamp);
      if (!Number.isInteger(days)) throw new RangeError("Study days must be an integer");
      const date = new Date(timestamp);
      return new Date(date.getFullYear(), date.getMonth(), date.getDate() + days).getTime();
    },
    dateKey(timestamp) {
      assertFiniteTimestamp(timestamp);
      const date = new Date(timestamp);
      const year = String(date.getFullYear()).padStart(4, "0");
      const month = String(date.getMonth() + 1).padStart(2, "0");
      const day = String(date.getDate()).padStart(2, "0");
      return `${year}-${month}-${day}`;
    },
  };
}
