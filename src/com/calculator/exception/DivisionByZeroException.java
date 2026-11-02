package com.calculator.exception;

/** Raised when an operation would divide by zero. */
public class DivisionByZeroException extends CalculatorException {

    public DivisionByZeroException() {
        super("Cannot divide by zero.");
    }

    public DivisionByZeroException(String message) {
        super(message);
    }
}
