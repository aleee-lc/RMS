import { CommonModule } from '@angular/common';
import { Component, EventEmitter, inject, Input, OnChanges, Output, SimpleChanges } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatDatepickerModule } from '@angular/material/datepicker';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatNativeDateModule } from '@angular/material/core';

function parseIsoDate(date: string): Date {
  const [year, month, day] = date.split('-').map((value) => Number(value));
  return new Date(year, month - 1, day);
}

function toIsoLocalDate(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

@Component({
  selector: 'app-date-range-filter',
  standalone: true,
  imports: [
    CommonModule,
    ReactiveFormsModule,
    MatFormFieldModule,
    MatInputModule,
    MatButtonModule,
    MatIconModule,
    MatDatepickerModule,
    MatNativeDateModule
  ],
  templateUrl: './date-range-filter.component.html',
  styleUrl: './date-range-filter.component.scss'
})
export class DateRangeFilterComponent implements OnChanges {
  private readonly fb = inject(FormBuilder);

  @Input({ required: true }) startDate = '';
  @Input({ required: true }) endDate = '';
  @Input() disabled = false;

  @Output() applyDateRange = new EventEmitter<{ startDate: string; endDate: string }>();

  readonly form = this.fb.group({
    startDate: [new Date(), Validators.required],
    endDate: [new Date(), Validators.required]
  });

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['startDate'] || changes['endDate']) {
      this.form.patchValue(
        {
          startDate: parseIsoDate(this.startDate),
          endDate: parseIsoDate(this.endDate)
        },
        { emitEvent: false }
      );
    }

    if (this.disabled) {
      this.form.disable({ emitEvent: false });
    } else {
      this.form.enable({ emitEvent: false });
    }
  }

  onApply(): void {
    const startDate = this.form.controls.startDate.value;
    const endDate = this.form.controls.endDate.value;

    if (!startDate || !endDate) {
      this.form.markAllAsTouched();
      return;
    }

    if (startDate.getTime() > endDate.getTime()) {
      this.form.controls.endDate.setErrors({ invalidRange: true });
      return;
    }

    this.applyDateRange.emit({
      startDate: toIsoLocalDate(startDate),
      endDate: toIsoLocalDate(endDate)
    });
  }
}
