package com.calculator.exception;

/**
 * Base type for all errors raised by the calculator domain.
 *
 * <p>Using a single root exception lets callers catch every calculator
 * failure with one handler while still allowing specific subtypes to be
 * caught individually when needed.
 */
public class CalculatorException extends RuntimeException {

    public CalculatorException(String message) {
        super(message);
    }

    public CalculatorException(String message, Throwable cause) {
        super(message, cause);
    }
}
